import { applyOffer } from "@/lib/pricing";
import { estimateEta } from "@/lib/eta";
import { distanceKm } from "@/lib/geo";
import { CANCEL_REASON_LABEL } from "@/lib/cancel-reasons";
import { STATUS_LABEL, canTransition, isFinal } from "@/lib/order-machine";
import type { CancelReasonCode, Delivery, DeliveryPartner, DeliveryStatus, Order, OrderItem, OrderStatus, OrderStatusHistory, PaymentMethod, Prescription, SessionUser } from "@/lib/types";
import { badRequest, conflict, forbidden, notFound } from "@/server/errors";
import { once } from "@/server/idempotency";
import { consume, release, reserve, restock, stockFor } from "@/server/features/inventory/stock";
import { notify, notifyPharmacy } from "@/server/features/notifications/notify";
import { deriveOtp, hashOtp, newNonce } from "@/server/features/delivery/otp";
import { codEligible, openPayment, paymentOf, paymentView, settlePaymentOnCancel } from "@/server/features/payments/payment.service";
import { audit, db, orderCode, settings, uid } from "@/server/store";
import { atomically } from "@/server/tx";
import { coverageForLocation } from "@/server/features/service-areas/service-areas.service";
import { computeDeliveryFee, distanceBetween } from "./fees";
import { cancellationRule, paymentWindowMs, PHARMACY_RESPONSE_WINDOW_MS, PRESCRIPTION_REVIEW_WINDOW_MS, pharmacyWindowFor } from "./policy";

export interface CreateOrderInput {
  pharmacyId: string;
  addressId: string;
  familyMemberId?: string;
  items: { medicineId: string; quantity: number }[];
  prescriptionId?: string;
  deliveryType: "NORMAL" | "PRIORITY";
  paymentMethod: PaymentMethod;
  offerCode?: string;
  isRepeat?: boolean;
}

export const ACTIVE_RIDER_STATUSES: OrderStatus[] = ["RIDER_ASSIGNED", "PICKED_UP", "OUT_FOR_DELIVERY"];
/** Default payment window. The live value comes from platform settings (paymentWindowMinutes). */
export const PAYMENT_WINDOW_MS = 30 * 60_000;
export { PHARMACY_RESPONSE_WINDOW_MS, PRESCRIPTION_REVIEW_WINDOW_MS };
/** The pickup code stops working after this long; the pharmacy can issue a fresh one. */
export const PICKUP_OTP_TTL_MS = 60 * 60_000;

type Actor = SessionUser | "SYSTEM";
const roleOf = (a: Actor) => (a === "SYSTEM" ? "SYSTEM" : a.role);
const auditActor = (a: Actor) => (a === "SYSTEM" ? ({ id: "system", role: "SYSTEM" } as const) : a);

// ───────────────────────── Status ledger ─────────────────────────

/** Appends one OrderStatusHistory row (and the short copy kept on the order for rendering). */
export function recordStatus(o: Order, from: OrderStatus | undefined, to: OrderStatus, actor: Actor, note?: string): OrderStatusHistory {
  const at = new Date().toISOString();
  const row: OrderStatusHistory = { id: uid("osh"), orderId: o.id, fromStatus: from, toStatus: to, changedBy: actor === "SYSTEM" ? "system" : actor.id, actorRole: roleOf(actor), note, timestamp: at };
  db().orderStatusHistory.push(row);
  o.statusHistory.push({ status: to, at, note, by: actor === "SYSTEM" ? undefined : actor.role });
  return row;
}

/** A note on the order that is not a status change (e.g. "clearer prescription attached"). Recorded with from = to. */
export const noteOnOrder = (o: Order, actor: Actor, note: string) => recordStatus(o, o.status, o.status, actor, note);

// ───────────────────────── Deliveries (OTP-protected hand-overs) ─────────────────────────

const FINISHED_DELIVERY: DeliveryStatus[] = ["CANCELLED", "DELIVERED", "RETURNED_TO_PHARMACY"];
/** The delivery that is still in play for this order (a returned or cancelled one is history). */
export const deliveryOf = (o: Order): Delivery | undefined => db().deliveries.find((x) => x.orderId === o.id && !FINISHED_DELIVERY.includes(x.status));
/** The most recent delivery, finished or not. */
export const latestDelivery = (o: Order): Delivery | undefined => db().deliveries.findLast((x) => x.orderId === o.id);

/** Created when the pharmacy marks the order ready. Holds the OTP hashes, never the codes. Safe to call twice. */
function openDelivery(o: Order): Delivery {
  const existing = deliveryOf(o);
  if (existing) return existing;
  const cfg = settings();
  const ph = db().pharmacies.find((p) => p.id === o.pharmacyId)!;
  const id = uid("dl");
  const nonce = newNonce();
  const pickupNonce = newNonce();
  const km = distanceBetween(ph, o.addressSnapshot);
  const base = o.deliveryType === "PRIORITY" ? cfg.riderPayoutPriority : cfg.riderPayoutNormal;
  const distance = Math.round(Math.max(0, (km ?? 0) - 1) * (cfg.riderPerKm ?? 0));
  const dl: Delivery = {
    id, orderId: o.id, status: "WAITING_FOR_RIDER", payout: base + distance, earning: { base, distance, incentive: 0 }, distanceKm: km,
    cashToCollect: o.paymentMethod === "COD" ? o.total : 0, otpNonce: nonce, pickupOtpNonce: pickupNonce,
    pickupOtpHash: hashOtp(id, "PICKUP", deriveOtp(id, pickupNonce, "PICKUP")), deliveryOtpHash: hashOtp(id, "DELIVERY", deriveOtp(id, nonce, "DELIVERY")),
    pickupOtpExpiresAt: new Date(Date.now() + PICKUP_OTP_TTL_MS).toISOString(),
    pickupAttempts: 0, deliveryAttempts: 0, attemptNo: 1, createdAt: new Date().toISOString(),
  };
  db().deliveries.push(dl);
  return dl;
}

/** The code a pharmacy or customer reads out. Derived on demand; only its hash is stored. */
export const codeFor = (dl: Delivery, purpose: "PICKUP" | "DELIVERY") => deriveOtp(dl.id, purpose === "PICKUP" ? (dl.pickupOtpNonce ?? dl.otpNonce) : dl.otpNonce, purpose);

/** Pharmacy asks for a new pickup code (the old one expired or was read out loud to the wrong person). Resets the wrong-guess counter. */
export function refreshPickupCode(user: SessionUser, orderId: string) {
  const o = ownPharmacyOrder(user, orderId);
  const dl = deliveryOf(o);
  if (!dl || !["READY_FOR_PICKUP", "RIDER_ASSIGNED"].includes(o.status) || dl.status === "PICKED_UP") throw conflict("There is no pickup waiting for a code");
  const nonce = newNonce();
  dl.pickupOtpNonce = nonce;
  dl.pickupOtpHash = hashOtp(dl.id, "PICKUP", deriveOtp(dl.id, nonce, "PICKUP"));
  dl.pickupOtpExpiresAt = new Date(Date.now() + PICKUP_OTP_TTL_MS).toISOString();
  dl.pickupAttempts = 0;
  audit(user, "PICKUP_CODE_REFRESHED", "Delivery", dl.id, { orderId: o.id });
  return { pickupOtp: codeFor(dl, "PICKUP"), expiresAt: dl.pickupOtpExpiresAt };
}

// ───────────────────────── State machine ─────────────────────────

export interface TransitionOptions {
  reasonCode?: CancelReasonCode;
  /** The caller sends its own customer notification */
  silent?: boolean;
}

/**
 * The ONLY way an order's status changes. Validates against the state machine and the cancellation rules, runs side effects
 * (stock consume/release, refunds, delivery record), writes the OrderStatusHistory row, and sends the customer notification.
 */
export function transition(o: Order, to: OrderStatus, actor: Actor, note?: string, opts: TransitionOptions = {}): Order {
  const from = o.status;
  if (!canTransition(from, to, roleOf(actor))) {
    throw conflict(`This order cannot go from “${STATUS_LABEL[from]}” to “${STATUS_LABEL[to]}” right now.`);
  }
  if (to === "CANCELLED") {
    const rule = cancellationRule(o, roleOf(actor), latestDelivery(o));
    if (rule.decision === "DENY") throw conflict(rule.message ?? "This order can no longer be cancelled.");
  } else if (o.partialFulfillment?.status === "PENDING_CUSTOMER") {
    throw conflict("Waiting for the customer to answer about the unavailable medicines.");
  }
  const d = db();
  const before = { status: from, paymentStatus: o.paymentStatus, stockState: o.stockState };
  if (to === "CONFIRMED") {
    if (o.items.some((i) => i.prescriptionRequired)) {
      const rx = d.prescriptions.find((p) => p.id === o.prescriptionId);
      if (rx?.status !== "APPROVED") throw conflict("The prescription is not approved for this order");
    }
    if (o.paymentMethod !== "COD" && o.paymentStatus !== "PAID" && o.paymentStatus !== "AUTHORIZED") throw conflict("Waiting for the customer's payment");
    // The units were reserved at checkout; confirming turns the promise into consumption.
    if (o.stockState === "RESERVED") { consume(o.stockAllocations); o.stockState = "CONSUMED"; }
    o.reservationExpiresAt = undefined;
  }
  if (to === "CANCELLED") {
    if (o.stockState === "RESERVED") release(o.stockAllocations);
    else if (o.stockState === "CONSUMED") restock(o.stockAllocations);
    o.stockState = "RELEASED";
    settlePaymentOnCancel(o, auditActor(actor), note ?? CANCEL_REASON_LABEL[opts.reasonCode ?? "OTHER"]);
    const dl = deliveryOf(o);
    if (dl) { dl.status = "CANCELLED"; dl.failureReason = note ?? "Order cancelled"; dl.lastLocation = undefined; }
    o.deliveryPartnerId = undefined;
    o.paymentExpiresAt = undefined;
    o.reservationExpiresAt = undefined;
    o.cancelReason = note;
    o.cancelReasonCode = opts.reasonCode ?? "OTHER";
    o.cancelledAt = new Date().toISOString();
    o.cancelledByUserId = actor === "SYSTEM" ? undefined : actor.id;
    o.cancelledBy = actor === "SYSTEM" ? undefined : actor.role;
    if (o.cancellationRequest?.status === "PENDING") Object.assign(o.cancellationRequest, { status: "APPROVED", decidedBy: actor === "SYSTEM" ? "system" : actor.id, decidedAt: o.cancelledAt });
    if (o.partialFulfillment?.status === "PENDING_CUSTOMER") Object.assign(o.partialFulfillment, { status: "DECLINED", decidedAt: o.cancelledAt });
  }
  if (to === "READY_FOR_PICKUP") {
    if (from === "RIDER_ASSIGNED") {
      // Rider dropped the job: back in the pool, same one-time codes.
      const dl = deliveryOf(o);
      if (dl) { dl.status = "WAITING_FOR_RIDER"; dl.partnerId = undefined; dl.acceptedAt = undefined; dl.lastLocation = undefined; }
      o.deliveryPartnerId = undefined;
    } else openDelivery(o);
  }
  o.status = to;
  recordStatus(o, from, to, actor, note);
  if (to === "CANCELLED") audit(auditActor(actor), "ORDER_CANCELLED", "Order", o.id, { reasonCode: o.cancelReasonCode, note }, { before, after: { status: "CANCELLED", paymentStatus: o.paymentStatus, refundStatus: o.refundStatus, stockState: o.stockState } });
  if (!opts.silent) notifyTransition(o, from, to, note);
  return o;
}

/** One place decides what the customer is told. Medicine names never go into these texts. */
function notifyTransition(o: Order, from: OrderStatus, to: OrderStatus, note?: string) {
  const pharmacy = db().pharmacies.find((p) => p.id === o.pharmacyId)?.name ?? "The pharmacy";
  switch (to) {
    case "PRESCRIPTION_APPROVED": return notify(o.userId, "PRESCRIPTION_APPROVED", "Prescription approved", `The pharmacist approved the prescription for order ${o.code}.`);
    case "CONFIRMED": return notify(o.userId, "ORDER_CONFIRMED", "Order confirmed", `${pharmacy} confirmed order ${o.code}.`);
    case "PREPARING": return notify(o.userId, "ORDER_PREPARING", "Pharmacy is preparing your order", `${pharmacy} started preparing order ${o.code}.`);
    case "READY_FOR_PICKUP": return from === "RIDER_ASSIGNED" ? undefined : notify(o.userId, "ORDER_READY", "Order is ready", `Order ${o.code} is packed and waiting for a delivery partner.`);
    case "RIDER_ASSIGNED": return; // the assignment itself names the rider
    case "OUT_FOR_DELIVERY": return notify(o.userId, "OUT_FOR_DELIVERY", "Your order is on the way", `Order ${o.code} is out for delivery. Keep your delivery code ready.`);
    case "DELIVERED": return notify(o.userId, "ORDER_DELIVERED", "Order delivered", `Order ${o.code} was delivered. Thank you!`);
    case "CANCELLED": {
      const refund = o.refundStatus !== "NOT_REQUIRED" ? " Your payment is being refunded." : "";
      return notify(o.userId, "ORDER_CANCELLED", "Order cancelled", `Order ${o.code} was cancelled.${note ? ` ${note}.` : ""}${refund}`.replace("..", "."));
    }
    default: return;
  }
}

/**
 * Gives stock back for orders nobody completed. Runs from the server's housekeeping timer and also before checkout and list
 * requests, so it never depends on a browser timer or an open page:
 *  - online order not paid in time (retries included: the window is fixed at checkout)
 *  - nobody (pharmacy / pharmacist) confirmed it in time
 * The order is cancelled by SYSTEM and the reserved units are released through the same state machine as any cancellation.
 */
export function expireReservations(at = Date.now()): number {
  let n = 0;
  for (const o of db().orders) {
    if (isFinal(o.status) || o.stockState !== "RESERVED" || !o.reservationExpiresAt || Date.parse(o.reservationExpiresAt) > at) continue;
    const unpaidOnline = o.paymentMethod !== "COD" && o.paymentStatus !== "PAID" && o.paymentStatus !== "AUTHORIZED";
    transition(o, "CANCELLED", "SYSTEM", unpaidOnline ? "Payment was not received in time" : "The pharmacy could not confirm it in time. You have not been charged", { reasonCode: unpaidOnline ? "PAYMENT_ISSUE" : "NO_RESPONSE" });
    n++;
  }
  return n;
}
/** Older name, kept for callers that only care about unpaid orders. */
export const expireUnpaidOrders = expireReservations;

// ───────────────────────── Checkout ─────────────────────────

/**
 * Checkout, in this order. Any failure rolls everything back (see atomically):
 *  1 service area live · 2 pharmacy exists · 3 pharmacy verified & open · 4 medicines exist · 5 stock available
 *  6 prescription rules · 7 prices and fees computed here, never taken from the client · 8 stock reserved · 9 order created · 10 payment record
 *
 * With an Idempotency-Key a repeated request (double tap, slow network, retry) returns the FIRST order instead of making another.
 */
export function placeOrder(user: SessionUser, input: CreateOrderInput, idempotencyKey?: string): { order: Order; replayed: boolean } {
  const r = once("checkout", idempotencyKey, user.id, input, () =>
    atomically(["orders", "orderStatusHistory", "inventory", "payments", "paymentAttempts", "carts", "prescriptions", "notifications", "audit"], () => createOrderInner(user, input, idempotencyKey).id), 201);
  return { order: db().orders.find((o) => o.id === r.value)!, replayed: r.replayed };
}
export const createOrder = (user: SessionUser, input: CreateOrderInput, idempotencyKey?: string): Order => placeOrder(user, input, idempotencyKey).order;

function createOrderInner(user: SessionUser, input: CreateOrderInput, idempotencyKey?: string): Order {
  const d = db();
  expireReservations();
  const address = d.addresses.find((a) => a.id === input.addressId && a.userId === user.id);
  if (!address) throw badRequest("Please choose a delivery address");
  // 1. Service area
  const cover = coverageForLocation(address);
  if (!cover.available) throw badRequest(cover.message ?? "We do not deliver to this area yet", { addressId: cover.status });
  // 2-3. Pharmacy
  const pharmacy = d.pharmacies.find((p) => p.id === input.pharmacyId);
  if (!pharmacy) throw badRequest("This pharmacy is not available");
  if (pharmacy.verification !== "VERIFIED") throw badRequest("This pharmacy is not available");
  if (!pharmacy.acceptingOrders) throw badRequest("This pharmacy is not taking orders right now");
  if (!pharmacy.servicePincodes.includes(address.pincode)) throw badRequest("This pharmacy does not deliver to your pincode");
  if (input.deliveryType === "PRIORITY" && !pharmacy.priorityDelivery) throw badRequest("Priority delivery is not available from this pharmacy");
  if (input.familyMemberId && !d.familyMembers.some((f) => f.id === input.familyMemberId && f.userId === user.id)) throw badRequest("Unknown family member");

  const orderId = uid("ord");
  const merged = new Map<string, number>();
  for (const it of input.items) merged.set(it.medicineId, (merged.get(it.medicineId) ?? 0) + it.quantity);

  // 4-5. Medicines and stock. Names and prices are COPIED onto the order so history stays right after catalogue changes.
  const items: OrderItem[] = [];
  let needsRx = false;
  let hasRestricted = false;
  let n = 0;
  for (const [medicineId, quantity] of merged) {
    const med = d.medicines.find((m) => m.id === medicineId);
    if (!med) throw badRequest("A medicine in your cart no longer exists");
    const stock = stockFor(pharmacy.id, medicineId); // availability is pharmacy-specific and excludes reserved units
    if (!stock || stock.quantity < quantity) throw conflict(`${med.name} is not available in the quantity you chose at this pharmacy`);
    // Price integrity, from OUR data: a batch that sells above its own MRP is a data error, never passed on to a customer
    if (!(stock.sellingPrice > 0) || stock.sellingPrice > stock.mrp) throw conflict(`${med.name} cannot be ordered right now. The pharmacy is updating its price.`);
    if (med.status !== "ACTIVE") throw conflict(`${med.name} is no longer available`);
    if (med.prescriptionRequired) needsRx = true;
    if (med.restricted) hasRestricted = true;
    items.push({ id: `${orderId}_i${++n}`, orderId, medicineId, name: med.name, strength: med.strength, quantity, mrp: stock.mrp, unitPrice: stock.sellingPrice, prescriptionRequired: med.prescriptionRequired });
  }

  // 6. Prescription rules: never bypassable
  const rx = input.prescriptionId ? d.prescriptions.find((p) => p.id === input.prescriptionId && p.userId === user.id) : undefined;
  if (input.prescriptionId && !rx) throw badRequest("Prescription not found");
  if (rx) {
    if (rx.status === "REJECTED") throw badRequest("This prescription was rejected. Please upload a new one.");
    if (isExpired(rx)) { rx.status = "EXPIRED"; throw badRequest("This prescription has expired. Please upload a new one."); }
  }
  if (needsRx && !rx) throw badRequest("A valid prescription is required for the prescription medicines in your cart");
  if (hasRestricted && rx?.status !== "APPROVED") throw badRequest("Restricted medicines can only be ordered with an already-approved prescription");

  // 7. Totals (server-side only)
  const cfg = settings();
  const subtotal = items.reduce((s, i) => s + i.unitPrice * i.quantity, 0);
  const km = distanceBetween(pharmacy, address);
  const fee = computeDeliveryFee({ subtotal, type: input.deliveryType, distanceKm: km, address, cfg });
  const code = input.offerCode?.toUpperCase();
  const offer = code ? d.offers.find((o) => o.code === code) : undefined;
  if (input.offerCode && !offer) throw badRequest("This offer code is not valid");
  const discount = applyOffer(subtotal, offer);
  const platformFee = cfg.platformFee ?? 0;
  const total = subtotal + fee.fee + platformFee - discount;
  if (input.paymentMethod === "COD") {
    const ok = codEligible({ total, status: "PENDING" });
    if (!ok.ok) throw badRequest(ok.reason ?? "Cash on delivery is not available for this order");
  }

  const riderAvailable = d.deliveryPartners.some((p) => p.available && p.verification === "VERIFIED");
  const eta = estimateEta({ distanceKm: km ?? 2, prepMinutes: pharmacy.avgPrepMinutes, needsPrescriptionReview: needsRx, riderAvailable, deliveryType: input.deliveryType, config: cfg.eta });

  // 8. Reserve stock
  const allocations = reserve(pharmacy.id, items);

  // 9-10. Order + payment
  const { id: _a, userId: _u, ...snap } = address;
  void _a; void _u;
  const now = new Date().toISOString();
  const initial: OrderStatus = needsRx ? "PRESCRIPTION_REVIEW" : "PENDING";
  const online = input.paymentMethod !== "COD";
  const order: Order = {
    id: orderId, code: orderCode(), userId: user.id, familyMemberId: input.familyMemberId, pharmacyId: pharmacy.id, addressId: address.id, addressSnapshot: snap,
    items, prescriptionId: rx?.id, status: initial, statusHistory: [],
    deliveryType: input.deliveryType, subtotal, deliveryFee: fee.fee, platformFee, feeBreakdown: fee.breakdown, discount, offerCode: offer?.code, total,
    paymentMethod: input.paymentMethod, paymentStatus: "PENDING", refundStatus: "NOT_REQUIRED",
    etaMinutes: eta.minutes, etaRange: eta.range, isRepeat: input.isRepeat, createdAt: now, idempotencyKey,
    stockAllocations: allocations, stockState: "RESERVED", paymentExpiresAt: online ? new Date(Date.now() + paymentWindowMs()).toISOString() : undefined,
    reservationExpiresAt: new Date(Date.now() + (online ? paymentWindowMs() : pharmacyWindowFor({ items }))).toISOString(),
  };
  recordStatus(order, undefined, initial, user, "Order placed");
  if (rx) { rx.status = rx.status === "APPROVED" ? "APPROVED" : "UNDER_REVIEW"; rx.pharmacyId = pharmacy.id; }
  d.orders.unshift(order);
  openPayment(order, user.id);
  notify(user.id, "ORDER_PLACED", "Order placed", `Order ${order.code} was sent to ${pharmacy.name}.`);
  // The cart has served its purpose
  d.carts = d.carts.filter((c) => c.userId !== user.id);
  return order;
}

export const isExpired = (rx: Pick<Prescription, "expiresAt">, at = Date.now()) => !!rx.expiresAt && Date.parse(rx.expiresAt) < at;

export function getOrderFor(user: SessionUser, orderId: string): Order {
  const o = db().orders.find((x) => x.id === orderId || x.code === orderId);
  if (!o) throw notFound("Order not found");
  const staff = (user.role === "PHARMACY_ADMIN" || user.role === "PHARMACIST") && user.partnerId === o.pharmacyId;
  const rider = user.role === "DELIVERY_PARTNER" && user.partnerId === o.deliveryPartnerId;
  if (!(o.userId === user.id || staff || rider || user.role === "SUPER_ADMIN")) throw forbidden();
  return o;
}

export const listOrdersFor = (user: SessionUser): Order[] => db().orders.filter((o) => o.userId === user.id);

// ───────────────────────── Cancellation ─────────────────────────

export type CancelInput = string | { reasonCode: CancelReasonCode; note?: string };
const ORDER_COLLECTIONS = ["orders", "orderStatusHistory", "inventory", "payments", "paymentAttempts", "refunds", "deliveries", "notifications", "audit", "prescriptions"] as const;

/**
 * Cancel an order, following the cancellation matrix (policy.ts). Customers cancel freely until the pharmacy starts preparing; after
 * that they ask, and the pharmacy or support decides. Once the parcel is picked up nobody cancels from the app: it comes back
 * through the failed-delivery and return flow. Stock is released and prepaid money is refunded by the state machine.
 */
export function cancelOrder(user: SessionUser, orderId: string, input: CancelInput) {
  const { reasonCode, note } = typeof input === "string" ? { reasonCode: "OTHER" as CancelReasonCode, note: input } : input;
  return atomically(ORDER_COLLECTIONS, () => {
    const o = getOrderFor(user, orderId);
    if (user.role === "CUSTOMER" && o.userId !== user.id) throw forbidden();
    const rule = cancellationRule(o, user.role, latestDelivery(o));
    if (rule.decision === "DENY") throw conflict(rule.message ?? "This order can no longer be cancelled");
    if (rule.decision === "REQUEST") return requestCancellation(user, o, reasonCode, note, rule.message);
    transition(o, "CANCELLED", user, note ? `${CANCEL_REASON_LABEL[reasonCode]}: ${note}` : CANCEL_REASON_LABEL[reasonCode], { reasonCode });
    return o;
  });
}

function requestCancellation(user: SessionUser, o: Order, reasonCode: CancelReasonCode, note: string | undefined, message?: string) {
  if (o.cancellationRequest?.status === "PENDING") return o; // asking twice changes nothing
  const before = o.cancellationRequest;
  o.cancellationRequest = { reasonCode, note, requestedAt: new Date().toISOString(), status: "PENDING" };
  noteOnOrder(o, user, `Customer asked to cancel (${CANCEL_REASON_LABEL[reasonCode]})`);
  audit(user, "ORDER_CANCEL_REQUESTED", "Order", o.id, { reasonCode, note }, { before, after: o.cancellationRequest });
  notifyPharmacy(o.pharmacyId, "SUPPORT_ALERT", "Customer wants to cancel", `The customer of order ${o.code} asked to cancel. Please approve or decline.`);
  notify(o.userId, "SUPPORT_ALERT", "Cancellation requested", message ?? `We asked the pharmacy to cancel order ${o.code}.`);
  return o;
}

/** The pharmacy (or support) answers a customer's request to cancel an order that is already being prepared. */
export function decideCancellation(user: SessionUser, orderId: string, decision: "APPROVE" | "REJECT", note?: string) {
  return atomically(ORDER_COLLECTIONS, () => {
    const o = ownPharmacyOrder(user, orderId);
    const req = o.cancellationRequest;
    if (!req || req.status !== "PENDING") throw conflict("There is no cancellation request waiting for an answer");
    if (decision === "APPROVE") {
      transition(o, "CANCELLED", user, `${CANCEL_REASON_LABEL[req.reasonCode]}${req.note ? `: ${req.note}` : ""}`, { reasonCode: req.reasonCode });
      Object.assign(o.cancellationRequest!, { status: "APPROVED", decidedBy: user.id, decidedAt: new Date().toISOString(), decisionNote: note });
    } else {
      if (!note?.trim()) throw badRequest("Please tell the customer why the order cannot be cancelled now");
      const before = { ...req };
      Object.assign(req, { status: "REJECTED", decidedBy: user.id, decidedAt: new Date().toISOString(), decisionNote: note });
      noteOnOrder(o, user, `Cancellation declined: ${note}`);
      audit(user, "ORDER_CANCEL_DECLINED", "Order", o.id, { note }, { before, after: req });
      notify(o.userId, "SUPPORT_ALERT", "Cancellation not possible", `Order ${o.code} is already being prepared, so it could not be cancelled. ${note}`);
    }
    return o;
  });
}

/** After a clarification request, the customer attaches a clearer prescription and review restarts. */
export function attachPrescription(user: SessionUser, orderId: string, prescriptionId: string) {
  const o = getOrderFor(user, orderId);
  if (o.userId !== user.id) throw forbidden();
  if (o.status !== "PRESCRIPTION_REVIEW") throw conflict("This order is not waiting for a prescription");
  const rx = db().prescriptions.find((p) => p.id === prescriptionId && p.userId === user.id);
  if (!rx) throw badRequest("Prescription not found");
  if (rx.status === "REJECTED") throw badRequest("This prescription was rejected");
  o.prescriptionId = rx.id;
  rx.pharmacyId = o.pharmacyId;
  if (rx.status !== "APPROVED") rx.status = "UNDER_REVIEW";
  noteOnOrder(o, user, "New prescription attached");
  return o;
}

// ───────────────────────── Pharmacy side ─────────────────────────

/** The order must belong to the caller's own pharmacy (platform admins may act on any). */
export function ownPharmacyOrder(user: SessionUser, orderId: string): Order {
  const o = db().orders.find((x) => x.id === orderId);
  if (!o) throw notFound("Order not found");
  if (user.role !== "SUPER_ADMIN" && o.pharmacyId !== user.partnerId) throw forbidden();
  // A suspended or unapproved pharmacy cannot work orders
  const ph = db().pharmacies.find((p) => p.id === o.pharmacyId);
  if (user.role !== "SUPER_ADMIN" && ph?.verification !== "VERIFIED") throw forbidden("Your pharmacy is not active. Please contact support.");
  return o;
}

/** "Approve": verifies the prescription when one is under review, otherwise accepts (confirms) the order. */
export function approveOrder(user: SessionUser, orderId: string, note?: string) {
  const o = ownPharmacyOrder(user, orderId);
  return o.status === "PRESCRIPTION_REVIEW" ? reviewOrderPrescription(user, orderId, "APPROVE", note) : advanceAsPharmacy(user, orderId, "confirm");
}

/** Pharmacist verification of the prescription attached to an order. Never edits or substitutes items. */
export function reviewOrderPrescription(user: SessionUser, orderId: string, decision: "APPROVE" | "REJECT" | "CLARIFY", note?: string) {
  return atomically(ORDER_COLLECTIONS, () => {
    const o = ownPharmacyOrder(user, orderId);
    if (o.status !== "PRESCRIPTION_REVIEW") throw conflict("This order is not waiting for prescription review");
    const rx = db().prescriptions.find((p) => p.id === o.prescriptionId);
    if (!rx) throw conflict("This order has no prescription attached");
    if (isExpired(rx)) throw conflict("This prescription has expired. Ask the customer for a new one.");
    const rxBefore = rx.status;
    rx.reviewedBy = user.id;
    rx.reviewedAt = new Date().toISOString();
    rx.reviewNote = note;
    if (decision === "APPROVE") {
      rx.status = "APPROVED";
      transition(o, "PRESCRIPTION_APPROVED", user, note ?? "Prescription verified");
    } else if (decision === "REJECT") {
      if (!note?.trim()) throw badRequest("Please tell the customer why the prescription was rejected");
      if (rx.status !== "APPROVED") rx.status = "REJECTED";
      // Cancelling releases the reserved stock and refunds any online payment, through the same path as every cancellation
      transition(o, "CANCELLED", user, note, { reasonCode: "PRESCRIPTION_REJECTED", silent: true });
      notify(o.userId, "PRESCRIPTION_REJECTED", "Prescription could not be verified", `Order ${o.code} was cancelled. ${note}${o.refundStatus !== "NOT_REQUIRED" ? " Your payment is being refunded." : ""}`);
    } else {
      if (!note?.trim()) throw badRequest("Tell the customer what is unclear");
      rx.status = "NEEDS_CLARIFICATION";
      noteOnOrder(o, user, `Clearer prescription needed: ${note}`);
      notify(o.userId, "PRESCRIPTION_APPROVED", "Prescription needs a clearer copy", `Please upload a clearer prescription for order ${o.code}.`);
    }
    audit(user, `PRESCRIPTION_${decision}`, "Order", o.id, { prescriptionId: rx.id, note }, { before: { prescription: rxBefore, order: "PRESCRIPTION_REVIEW" }, after: { prescription: rx.status, order: o.status } });
    return o;
  });
}

/** Standalone review (e.g. a "Call Me" prescription that has no order yet). */
export function reviewPrescription(user: SessionUser, rxId: string, decision: "APPROVE" | "REJECT" | "CLARIFY", note?: string) {
  const d = db();
  const rx = d.prescriptions.find((p) => p.id === rxId);
  if (!rx) throw notFound("Prescription not found");
  // A prescription attached to an open order is reviewed through that order, so the order moves forward with it.
  const linked = d.orders.find((o) => o.prescriptionId === rx.id && o.status === "PRESCRIPTION_REVIEW");
  if (linked) { reviewOrderPrescription(user, linked.id, decision, note); return rx; }
  if (d.orders.some((o) => o.prescriptionId === rx.id && !isFinal(o.status))) throw conflict("This prescription belongs to an order that is already being prepared");
  if (user.role !== "SUPER_ADMIN" && rx.source !== "QUICK_ORDER" && rx.pharmacyId !== user.partnerId) throw forbidden();
  if (!["UPLOADED", "UNDER_REVIEW", "NEEDS_CLARIFICATION"].includes(rx.status)) throw conflict("This prescription was already reviewed");
  const before = rx.status;
  rx.reviewedBy = user.id;
  rx.reviewedAt = new Date().toISOString();
  rx.reviewNote = note;
  rx.pharmacyId ??= user.partnerId;
  rx.status = decision === "APPROVE" ? "APPROVED" : decision === "REJECT" ? "REJECTED" : "NEEDS_CLARIFICATION";
  audit(user, `PRESCRIPTION_${decision}`, "Prescription", rx.id, { note }, { before: { status: before }, after: { status: rx.status } });
  if (decision === "APPROVE") notify(rx.userId, "PRESCRIPTION_APPROVED", "Prescription approved", "Your prescription was verified by the pharmacist.");
  return rx;
}

export type PharmacyStep = "confirm" | "prepare" | "ready";
const STEP_TARGET: Record<PharmacyStep, OrderStatus> = { confirm: "CONFIRMED", prepare: "PREPARING", ready: "READY_FOR_PICKUP" };

/** confirm → prepare → ready. Each is a validated state-machine transition. */
export function advanceAsPharmacy(user: SessionUser, orderId: string, step: PharmacyStep) {
  return atomically(ORDER_COLLECTIONS, () => {
    const o = ownPharmacyOrder(user, orderId);
    transition(o, STEP_TARGET[step], user);
    if (step === "confirm") audit(user, "ORDER_CONFIRMED", "Order", o.id);
    return o;
  });
}

/** The pharmacy cannot accept (or finish) the order: it is cancelled, stock is released and prepaid money is refunded. */
export function rejectOrder(user: SessionUser, orderId: string, note: string, reasonCode: CancelReasonCode = "MEDICINE_UNAVAILABLE") {
  return atomically(ORDER_COLLECTIONS, () => {
    const o = ownPharmacyOrder(user, orderId);
    if (!note.trim()) throw badRequest("Please tell the customer why");
    if (["PICKED_UP", "OUT_FOR_DELIVERY"].includes(o.status)) throw conflict("This order is already out for delivery");
    transition(o, "CANCELLED", user, note, { reasonCode });
    audit(user, "ORDER_REJECTED", "Order", o.id, { note });
    return o;
  });
}

// ───────────────────────── Riders ─────────────────────────

const LIVE_DELIVERY: DeliveryStatus[] = ["ASSIGNED", "AT_PHARMACY", "PICKED_UP", "OUT_FOR_DELIVERY", "DELIVERY_FAILED", "RETURNING_TO_PHARMACY"];
/** Deliveries a rider is carrying right now. A rider with a failed delivery still holds the parcel until it is back at the pharmacy. */
export const riderLoad = (partnerId: string): number => db().deliveries.filter((x) => x.partnerId === partnerId && LIVE_DELIVERY.includes(x.status)).length;
export const maxConcurrentDeliveries = () => Math.max(1, settings().maxConcurrentDeliveries ?? 1);

/** Why this rider may not take this delivery, or undefined when they may. */
export function riderBlocker(p: DeliveryPartner, o: Order): { kind: "forbidden" | "conflict"; message: string } | undefined {
  if (p.verification !== "VERIFIED") return { kind: "forbidden", message: "This rider is not verified" };
  if (!p.available) return { kind: "conflict", message: "Go online to accept deliveries" };
  if (p.servicePincodes?.length && !p.servicePincodes.includes(o.addressSnapshot.pincode)) return { kind: "conflict", message: "This delivery is outside your service area" };
  if (riderLoad(p.id) >= maxConcurrentDeliveries()) return { kind: "conflict", message: maxConcurrentDeliveries() === 1 ? "Finish your current delivery before taking another" : "You already have " + maxConcurrentDeliveries() + " active deliveries" };
  return undefined;
}

/**
 * Links a rider to an order that is READY_FOR_PICKUP. The check ("nobody has it") and the write ("it is mine") happen in one
 * synchronous step, so two riders tapping Accept at the same moment cannot both win; the second gets "already taken".
 * With MongoDB behind several servers this becomes one conditional update: { _id, partnerId: null } → { partnerId }.
 */
export function assignPartner(o: Order, partner: DeliveryPartner, actor: SessionUser) {
  const dl = deliveryOf(o);
  if (o.deliveryPartnerId || (dl && dl.partnerId)) throw conflict("This delivery was already taken");
  const blocker = riderBlocker(partner, o);
  if (blocker) { if (blocker.kind === "forbidden") throw forbidden(blocker.message); throw conflict(blocker.message); }
  if (!dl || dl.status !== "WAITING_FOR_RIDER") throw conflict("This delivery is not waiting for a rider");
  transition(o, "RIDER_ASSIGNED", actor);
  o.deliveryPartnerId = partner.id;
  dl.partnerId = partner.id;
  dl.status = "ASSIGNED";
  dl.acceptedAt = new Date().toISOString();
  notify(o.userId, "RIDER_ASSIGNED", "Delivery partner assigned", `${partner.name} will deliver order ${o.code}.`);
}

/** Pharmacy-initiated assignment (nearest available rider unless one is chosen). */
export function assignRider(user: SessionUser, orderId: string, partnerId?: string) {
  return atomically(ORDER_COLLECTIONS, () => {
    const o = ownPharmacyOrder(user, orderId);
    if (o.status !== "READY_FOR_PICKUP") throw conflict("Mark the order ready for pickup before assigning a rider");
    const d = db();
    const ph = d.pharmacies.find((p) => p.id === o.pharmacyId)!;
    const eligible = d.deliveryPartners.filter((p) => !riderBlocker(p, o));
    const partner = partnerId
      ? eligible.find((p) => p.id === partnerId)
      : [...eligible].sort((a, b) => (a.location ? distanceKm(a.location, ph.location) : 99) - (b.location ? distanceKm(b.location, ph.location) : 99))[0];
    if (!partner) throw conflict("No delivery partner is available right now. Riders can also accept it from their app.");
    assignPartner(o, partner, user);
    audit(user, "RIDER_ASSIGNED", "Order", o.id, { partnerId: partner.id });
    return o;
  });
}

export function pharmacyOrders(user: SessionUser): Order[] {
  // Same gate as every pharmacy action: an applicant (no pharmacy yet) or a suspended pharmacy sees nothing, not an empty list.
  const ph = db().pharmacies.find((p) => p.id === user.partnerId);
  if (!ph) throw forbidden("Your pharmacy is not approved yet");
  if (ph.verification !== "VERIFIED") throw forbidden("Your pharmacy is not active. Please contact support.");
  return db().orders.filter((o) => o.pharmacyId === ph.id);
}

/** What a pharmacy sees of an order: items and the patient name/age/allergies it needs; area, not full address. */
export function pharmacyOrderView(o: Order) {
  const d = db();
  const rx = d.prescriptions.find((p) => p.id === o.prescriptionId);
  const fm = d.familyMembers.find((f) => f.id === o.familyMemberId);
  const rider = d.deliveryPartners.find((p) => p.id === o.deliveryPartnerId);
  const dl = latestDelivery(o);
  const pickupLive = ["READY_FOR_PICKUP", "RIDER_ASSIGNED"].includes(o.status) && deliveryOf(o);
  return {
    id: o.id, code: o.code, status: o.status, items: o.items, total: o.total, deliveryType: o.deliveryType, paymentMethod: o.paymentMethod, paymentStatus: o.paymentStatus,
    refundStatus: o.refundStatus, createdAt: o.createdAt, etaMinutes: o.etaMinutes, note: o.statusHistory.at(-1)?.note,
    pickupOtp: pickupLive ? codeFor(pickupLive, "PICKUP") : undefined,
    pickupOtpExpiresAt: pickupLive ? pickupLive.pickupOtpExpiresAt : undefined,
    patient: fm ? { name: fm.name, age: fm.age, allergies: fm.allergies } : { name: d.users.find((u) => u.id === o.userId)?.name ?? "Customer" },
    area: `${o.addressSnapshot.area}, ${o.addressSnapshot.pincode}`,
    rider: rider ? { name: rider.name, mobile: rider.mobile } : undefined,
    prescription: rx && { id: rx.id, status: rx.status, mimeType: rx.mimeType, note: rx.reviewNote },
    cancellationRequest: o.cancellationRequest?.status === "PENDING" ? { reasonCode: o.cancellationRequest.reasonCode, note: o.cancellationRequest.note, requestedAt: o.cancellationRequest.requestedAt } : undefined,
    partialFulfillment: o.partialFulfillment,
    delivery: dl && { status: dl.status, failureReasonCode: dl.failureReasonCode, attemptNo: dl.attemptNo, returnStartedAt: dl.returnStartedAt, returnedAt: dl.returnedAt },
  };
}

// ───────────────────────── Customer view & quote ─────────────────────────

/** Approximate rider position for the customer: rounded to about 100 m, hidden when stale, never a history. */
function approxTracking(o: Order) {
  const dl = deliveryOf(o);
  if (!dl?.lastLocation || !["PICKED_UP", "OUT_FOR_DELIVERY"].includes(o.status) || !["PICKED_UP", "OUT_FOR_DELIVERY"].includes(dl.status)) return undefined;
  const ageMin = (Date.now() - Date.parse(dl.lastLocation.at)) / 60_000;
  if (ageMin > 15) return undefined;
  const dest = o.addressSnapshot.location;
  const away = dest ? Math.round(distanceKm(dl.lastLocation, dest) * 2) / 2 : undefined;
  return { approximate: true as const, lat: Math.round(dl.lastLocation.lat * 1000) / 1000, lng: Math.round(dl.lastLocation.lng * 1000) / 1000, updatedAt: dl.lastLocation.at, kmAway: away };
}

export function userSafeOrder(o: Order, viewer: Pick<SessionUser, "role">) {
  const d = db();
  const ph = d.pharmacies.find((p) => p.id === o.pharmacyId);
  const partner = d.deliveryPartners.find((p) => p.id === o.deliveryPartnerId);
  const onTheWay = ACTIVE_RIDER_STATUSES.includes(o.status);
  const customer = viewer.role === "CUSTOMER";
  const pay = paymentOf(o.id);
  const rule = cancellationRule(o, viewer.role, latestDelivery(o));
  const dl = latestDelivery(o);
  return {
    ...o,
    // Delivery OTP is shown to the customer only; the pickup OTP only to pharmacy staff; never both to anyone else.
    deliveryOtp: customer && onTheWay && deliveryOf(o) ? codeFor(deliveryOf(o)!, "DELIVERY") : undefined,
    pickupOtp: (viewer.role === "PHARMACIST" || viewer.role === "PHARMACY_ADMIN") && ["READY_FOR_PICKUP", "RIDER_ASSIGNED"].includes(o.status) && deliveryOf(o) ? codeFor(deliveryOf(o)!, "PICKUP") : undefined,
    pharmacy: ph && { id: ph.id, name: ph.name, mobile: ph.mobile, address: ph.address },
    rider: partner && onTheWay ? { name: partner.name, mobile: partner.mobile, vehicle: partner.vehicle } : undefined,
    tracking: customer ? approxTracking(o) : undefined,
    delivery: dl && { status: dl.status, attemptNo: dl.attemptNo, failureReasonCode: dl.failureReasonCode, failedAt: dl.failedAt },
    payment: pay && (customer ? paymentView(pay) : { id: pay.id, status: pay.status, method: pay.method, amount: pay.amount, refundedAmount: pay.refundedAmount }),
    codAvailable: customer && o.paymentMethod !== "COD" && !isFinal(o.status) ? codEligible(o, pay).ok : false,
    canCancel: customer && rule.decision !== "DENY",
    cancelNeedsApproval: customer && rule.decision === "REQUEST",
    cancelNote: rule.message,
    stockAllocations: undefined,
    stockState: undefined,
    idempotencyKey: undefined,
  };
}

/** Price + ETA preview for checkout. Same rules as createOrder, mutates nothing. */
export function quoteOrder(user: SessionUser, input: { pharmacyId: string; addressId: string; items: { medicineId: string; quantity: number }[]; offerCode?: string }) {
  const d = db();
  const pharmacy = d.pharmacies.find((p) => p.id === input.pharmacyId);
  const address = d.addresses.find((a) => a.id === input.addressId && a.userId === user.id);
  if (!pharmacy || !address) throw badRequest("Choose a delivery address");
  let subtotal = 0;
  let needsRx = false;
  for (const it of input.items) {
    const stock = stockFor(pharmacy.id, it.medicineId);
    const med = d.medicines.find((m) => m.id === it.medicineId);
    if (!stock || !med) throw badRequest("A medicine in your cart is no longer available at this pharmacy");
    if (stock.quantity < it.quantity) throw conflict(`Only ${stock.quantity} of ${med.name} left at this pharmacy`);
    subtotal += stock.sellingPrice * it.quantity;
    if (med.prescriptionRequired) needsRx = true;
  }
  const cfg = settings();
  const riderAvailable = d.deliveryPartners.some((p) => p.available && p.verification === "VERIFIED");
  const km = distanceBetween(pharmacy, address);
  const eta = (deliveryType: "NORMAL" | "PRIORITY") => estimateEta({ distanceKm: km ?? 2, prepMinutes: pharmacy.avgPrepMinutes, needsPrescriptionReview: needsRx, riderAvailable, deliveryType, config: cfg.eta });
  const code = input.offerCode?.toUpperCase();
  const offer = code ? d.offers.find((o) => o.code === code) : undefined;
  const discount = applyOffer(subtotal, offer);
  const platformFee = cfg.platformFee ?? 0;
  const priced = (t: "NORMAL" | "PRIORITY") => {
    const f = computeDeliveryFee({ subtotal, type: t, distanceKm: km, address, cfg });
    const total = subtotal + f.fee + platformFee - discount;
    return { fee: f.fee, total, eta: eta(t), cod: codEligible({ total, status: "PENDING" }).ok };
  };
  return {
    subtotal, discount, platformFee, needsRx, offerValid: !input.offerCode || !!offer,
    normal: priced("NORMAL"),
    priority: pharmacy.priorityDelivery ? priced("PRIORITY") : null,
  };
}
