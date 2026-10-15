import { applyOffer } from "@/lib/pricing";
import type { Order, OrderItem, SessionUser } from "@/lib/types";
import { badRequest, conflict, forbidden } from "@/server/errors";
import { notify } from "@/server/features/notifications/notify";
import { release, restock } from "@/server/features/inventory/stock";
import { paymentOf, requestRefund } from "@/server/features/payments/payment.service";
import { audit, db, settings } from "@/server/store";
import { atomically } from "@/server/tx";
import { computeDeliveryFee } from "./fees";
import { getOrderFor, noteOnOrder, ownPharmacyOrder, transition } from "./orders.service";
import { partialWindowMs } from "./policy";

/**
 * Partial fulfilment: the pharmacy cannot supply everything.
 *
 *  1 the pharmacy lists what is missing and why (it never removes anything by itself, never substitutes)
 *  2 the server works out the new total and the customer is asked: continue with the rest, or cancel the whole order
 *  3 until the customer answers the pharmacy cannot move the order forward, and the stock stays reserved
 *  4 CONTINUE: the missing items leave the order, their stock goes back, totals are recomputed here, prepaid money for the
 *    difference is refunded. CANCEL (or no answer in time): the whole order is cancelled and refunded.
 */
const COLLECTIONS = ["orders", "orderStatusHistory", "inventory", "payments", "paymentAttempts", "refunds", "notifications", "audit", "deliveries"] as const;
const PROPOSE_FROM = ["PENDING", "PRESCRIPTION_APPROVED", "CONFIRMED", "PREPARING"] as const;

/** What the order would cost without the given items, using the same rules as checkout. */
function recompute(o: Order, remaining: OrderItem[]) {
  const d = db();
  const cfg = settings();
  const subtotal = remaining.reduce((s, i) => s + i.unitPrice * i.quantity, 0);
  const offer = o.offerCode ? d.offers.find((x) => x.code === o.offerCode) : undefined;
  const discount = applyOffer(subtotal, offer);
  const fee = computeDeliveryFee({ subtotal, type: o.deliveryType, distanceKm: o.feeBreakdown?.distanceKm, address: o.addressSnapshot, cfg });
  const deliveryFee = o.feeBreakdown?.rule === "AREA" ? o.deliveryFee : fee.fee; // an area rule's fee does not depend on the cart value
  return { subtotal, deliveryFee, discount, total: subtotal + deliveryFee + o.platformFee - discount, breakdown: fee.breakdown };
}

export function proposePartialFulfillment(user: SessionUser, orderId: string, unavailable: { itemId: string; reason: string }[]) {
  return atomically(COLLECTIONS, () => {
    const o = ownPharmacyOrder(user, orderId);
    if (!(PROPOSE_FROM as readonly string[]).includes(o.status)) throw conflict("Items can only be marked unavailable before the order is packed");
    if (o.partialFulfillment?.status === "PENDING_CUSTOMER") throw conflict("The customer has not answered the last request yet");
    if (o.paymentMethod !== "COD" && o.paymentStatus !== "PAID") throw conflict("Wait for the customer's payment before changing the order");
    if (!unavailable.length) throw badRequest("Choose the medicines you cannot supply");
    const ids = new Set(unavailable.map((u) => u.itemId));
    if (ids.size !== unavailable.length) throw badRequest("Each medicine can be listed once");
    const missing = o.items.filter((i) => ids.has(i.id));
    if (missing.length !== ids.size) throw badRequest("One of those medicines is not in this order");
    const remaining = o.items.filter((i) => !ids.has(i.id));
    if (!remaining.length) throw badRequest("If nothing can be supplied, reject the order instead");
    if (unavailable.some((u) => !u.reason.trim())) throw badRequest("Please give a reason for each medicine");
    const calc = recompute(o, remaining);
    const now = Date.now();
    o.partialFulfillment = {
      status: "PENDING_CUSTOMER",
      unavailable: unavailable.map((u) => { const it = missing.find((m) => m.id === u.itemId)!; return { itemId: it.id, name: `${it.name} ${it.strength}`.trim(), quantity: it.quantity, reason: u.reason.trim() }; }),
      proposed: { subtotal: calc.subtotal, deliveryFee: calc.deliveryFee, discount: calc.discount, total: calc.total },
      proposedBy: user.id, proposedAt: new Date(now).toISOString(), expiresAt: new Date(now + partialWindowMs()).toISOString(),
    };
    noteOnOrder(o, user, "Some medicines are not available. Waiting for the customer.");
    audit(user, "PARTIAL_FULFILLMENT_PROPOSED", "Order", o.id, { unavailable: o.partialFulfillment.unavailable }, { before: { items: o.items.length, total: o.total }, after: { items: remaining.length, total: calc.total } });
    notify(o.userId, "ORDER_PARTIAL_PROPOSED", "Some medicines are not available", `The pharmacy cannot supply everything in order ${o.code}. Please choose to continue with the rest or cancel.`);
    return o;
  });
}

export function decidePartialFulfillment(user: SessionUser, orderId: string, decision: "CONTINUE" | "CANCEL") {
  return atomically(COLLECTIONS, () => {
    const o = getOrderFor(user, orderId);
    if (o.userId !== user.id) throw forbidden();
    const pf = o.partialFulfillment;
    if (!pf) throw conflict("Nothing is waiting for your answer");
    // Answering twice is harmless: the first answer stands
    if (pf.status === "ACCEPTED" && decision === "CONTINUE") return o;
    if (pf.status === "DECLINED" && decision === "CANCEL") return o;
    if (pf.status !== "PENDING_CUSTOMER") throw conflict("This request is already closed");
    if (Date.parse(pf.expiresAt) < Date.now()) { expireOne(o); return o; }
    if (decision === "CANCEL") {
      transition(o, "CANCELLED", user, "Some medicines were unavailable", { reasonCode: "CUSTOMER_DECLINED_PARTIAL" });
      return o;
    }
    applyRemoval(o, user);
    return o;
  });
}

function applyRemoval(o: Order, actor: SessionUser | "SYSTEM") {
  const pf = o.partialFulfillment!;
  const d = db();
  const gone = new Set(pf.unavailable.map((u) => u.itemId));
  const removed = o.items.filter((i) => gone.has(i.id));
  const remaining = o.items.filter((i) => !gone.has(i.id));
  const calc = recompute(o, remaining);
  const before = { items: o.items.length, subtotal: o.subtotal, deliveryFee: o.deliveryFee, discount: o.discount, total: o.total };
  // Give back only the units of the removed medicines; the batches are found through the stock allocations
  const meds = new Set(removed.map((i) => i.medicineId));
  const back = o.stockAllocations.filter((a) => meds.has(d.inventory.find((b) => b.id === a.inventoryId)?.medicineId ?? ""));
  if (o.stockState === "RESERVED") release(back); else if (o.stockState === "CONSUMED") restock(back);
  o.stockAllocations = o.stockAllocations.filter((a) => !back.includes(a));
  o.removedItems = [...(o.removedItems ?? []), ...removed.map((i) => ({ ...i, removedReason: pf.unavailable.find((u) => u.itemId === i.id)?.reason ?? "Not available" }))];
  const paid = o.total;
  o.items = remaining;
  o.subtotal = calc.subtotal;
  o.deliveryFee = calc.deliveryFee;
  o.discount = calc.discount;
  o.total = calc.total;
  o.feeBreakdown = calc.breakdown;
  pf.status = "ACCEPTED";
  pf.decidedAt = new Date().toISOString();
  const pay = paymentOf(o.id);
  if (pay) {
    if (o.paymentMethod === "COD") { pay.amount = calc.total; pay.updatedAt = pf.decidedAt; }
    else if (paid > calc.total) {
      // The customer already paid for the full order: the difference goes back, once (key is per order)
      requestRefund({ payment: pay, amount: Math.round((paid - calc.total) * 100) / 100, actor: actor === "SYSTEM" ? { id: "system", role: "SYSTEM" } : actor, reason: "Some medicines were not available", key: `partial:${o.id}:${o.removedItems.length}` });
    }
  }
  const dl = d.deliveries.find((x) => x.orderId === o.id && x.cashToCollect > 0 && x.status === "WAITING_FOR_RIDER");
  if (dl) dl.cashToCollect = o.total;
  noteOnOrder(o, actor, `Continued without ${removed.length} unavailable item${removed.length === 1 ? "" : "s"}`);
  audit(actor === "SYSTEM" ? { id: "system", role: "SYSTEM" } : actor, "PARTIAL_FULFILLMENT_ACCEPTED", "Order", o.id, { removed: removed.map((i) => i.id) }, { before, after: { items: o.items.length, subtotal: o.subtotal, deliveryFee: o.deliveryFee, discount: o.discount, total: o.total } });
}

function expireOne(o: Order) {
  const pf = o.partialFulfillment!;
  pf.status = "EXPIRED";
  pf.decidedAt = new Date().toISOString();
  // No answer is never treated as "yes": the whole order is cancelled and refunded
  transition(o, "CANCELLED", "SYSTEM", "No answer about the unavailable medicines", { reasonCode: "NO_RESPONSE" });
  pf.status = "EXPIRED";
}

/** Housekeeping: customers who did not answer in time have their order cancelled (and refunded) so the pharmacy is not left waiting. */
export function expirePartialProposals(at = Date.now()): number {
  let n = 0;
  for (const o of db().orders) {
    if (o.partialFulfillment?.status === "PENDING_CUSTOMER" && Date.parse(o.partialFulfillment.expiresAt) <= at) { atomically(COLLECTIONS, () => expireOne(o)); n++; }
  }
  return n;
}
