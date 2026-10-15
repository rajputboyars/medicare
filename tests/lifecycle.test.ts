import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionUser } from "@/lib/types";
import { MED } from "@/server/seed";
import { availableQuantity } from "@/lib/types";
import { db, resetDb, settings } from "@/server/store";
import { rateLimiter } from "@/lib/rate-limit";
import { cancellationRule, CANCELLATION_MATRIX } from "@/server/features/orders/policy";
import {
  advanceAsPharmacy, cancelOrder, codeFor, createOrder, decideCancellation, deliveryOf, expireReservations, latestDelivery, placeOrder, refreshPickupCode, rejectOrder, reviewOrderPrescription, transition, userSafeOrder,
} from "@/server/features/orders/orders.service";
import { decidePartialFulfillment, expirePartialProposals, proposePartialFulfillment } from "@/server/features/orders/partial-fulfillment";
import { runOrderHousekeeping } from "@/server/features/orders/housekeeping";
import { computeDeliveryFee } from "@/server/features/orders/fees";
import { acceptDelivery, availableDeliveries, confirmReturnReceived, reportFailedDelivery, retryDelivery, returnDelivery, riderStep, updateRiderLocation } from "@/server/features/delivery/delivery.service";
import { adminRefund, createPaymentForOrder, deriveRefundStatus, getPaymentFor, paymentOf, processWebhook, retryPayment, attemptsOf } from "@/server/features/payments/payment.service";
import { mockGateway, signMockWebhook, toPaise } from "@/server/features/payments/providers";
import { adjustSettlement, generateSettlements, pharmacyComponents, promoteEligibleSettlements, riderComponents, setSettlementStatus } from "@/server/features/settlements/settlements.service";
import { storePrescription } from "@/server/features/prescriptions/prescriptions.service";
import { estimateEta } from "@/lib/eta";
import { call, jar, route, signIn } from "./helpers/http";
import { confirmPayment, failPayment } from "./helpers/pay";

vi.mock("next/headers", async () => await import("./helpers/next-headers"));

const customer: SessionUser = { id: "u_1", name: "Asha", role: "CUSTOMER" };
const customer2: SessionUser = { id: "u_2", name: "Rajesh", role: "CUSTOMER" };
const pharmacist: SessionUser = { id: "u_rx", name: "Kavita", role: "PHARMACIST", partnerId: "ph_1" };
const otherPharmacy: SessionUser = { id: "u_ph2", name: "Sunita", role: "PHARMACY_ADMIN", partnerId: "ph_2" };
const rider4: SessionUser = { id: "u_dp4", name: "Vikas", role: "DELIVERY_PARTNER", partnerId: "dp_4" };
const rider3: SessionUser = { id: "u_dp3", name: "Imran", role: "DELIVERY_PARTNER", partnerId: "dp_3" };
const admin: SessionUser = { id: "u_ad", name: "Admin", role: "SUPER_ADMIN", elevated: true };

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0, 1, 2, 3]);
const rxFile = { name: "rx.png", type: "image/png", bytes: PNG };
const base = { pharmacyId: "ph_1", addressId: "ad_1", deliveryType: "NORMAL" as const, paymentMethod: "COD" as const };
const otc = (qty = 2, extra: Partial<Parameters<typeof createOrder>[1]> = {}) => createOrder(customer, { ...base, items: [{ medicineId: MED.PARACETAMOL, quantity: qty }], ...extra });
const online = (qty = 2) => otc(qty, { paymentMethod: "UPI" });
const reservedOf = (ph: string, med: string) => db().inventory.filter((i) => i.pharmacyId === ph && i.medicineId === med).reduce((s, i) => s + i.reservedQuantity, 0);
const stockOf = (ph: string, med: string) => db().inventory.filter((i) => i.pharmacyId === ph && i.medicineId === med).reduce((s, i) => s + i.stockQuantity, 0);
const availOf = (ph: string, med: string) => db().inventory.filter((i) => i.pharmacyId === ph && i.medicineId === med).reduce((s, i) => s + availableQuantity(i), 0);
const pay = (id: string) => paymentOf(id)!;
const pickup = (id: string) => codeFor(deliveryOf(db().orders.find((x) => x.id === id)!)!, "PICKUP");
const dcode = (id: string) => codeFor(deliveryOf(db().orders.find((x) => x.id === id)!)!, "DELIVERY");
const step = (o: { id: string }, s: "confirm" | "prepare" | "ready") => advanceAsPharmacy(pharmacist, o.id, s);

function ready(o = otc()) { step(o, "confirm"); step(o, "prepare"); step(o, "ready"); return o; }
function pickedUp(o = ready()) { acceptDelivery(rider4, o.id); riderStep(rider4, o.id, "PICKUP", pickup(o.id)); riderStep(rider4, o.id, "START"); return o; }
const finish = (o: { id: string; total: number }) => riderStep(rider4, o.id, "DELIVER", dcode(o.id), { cashCollected: o.total });

/** A signed webhook as the gateway would send it. */
function webhook(body: Record<string, unknown>, sign = true) {
  const raw = JSON.stringify(body);
  return processWebhook(raw, sign ? signMockWebhook(raw) : "deadbeef", "MOCK");
}
const capture = (o: { id: string }, extra: Record<string, unknown> = {}, eventId = `evt_${Math.random()}`) => {
  const a = attemptsOf(pay(o.id).id).at(-1)!;
  return webhook({ eventId, type: "PAYMENT_CAPTURED", providerOrderId: a.providerOrderId, providerPaymentId: `pp_${eventId}`, amountPaise: toPaise(a.amount), ...extra });
};

beforeEach(() => { resetDb(); mockGateway.reset(); jar.token = undefined; rateLimiter.reset?.(); });

// ───────────────────────── Order creation ─────────────────────────

describe("checkout", () => {
  it("is idempotent: the same Idempotency-Key returns the first order, with one reservation and one payment", () => {
    const before = reservedOf("ph_1", MED.PARACETAMOL);
    const input = { ...base, items: [{ medicineId: MED.PARACETAMOL, quantity: 2 }] };
    const first = placeOrder(customer, input, "key-checkout-1");
    const again = placeOrder(customer, input, "key-checkout-1");
    expect(again.replayed).toBe(true);
    expect(again.order.id).toBe(first.order.id);
    expect(db().orders.filter((o) => o.idempotencyKey === "key-checkout-1")).toHaveLength(1);
    expect(db().payments.filter((p) => p.orderId === first.order.id)).toHaveLength(1);
    expect(reservedOf("ph_1", MED.PARACETAMOL)).toBe(before + 2);
  });
  it("refuses the same key for a different basket (a caller bug, not a retry)", () => {
    placeOrder(customer, { ...base, items: [{ medicineId: MED.PARACETAMOL, quantity: 2 }] }, "key-checkout-2");
    expect(() => placeOrder(customer, { ...base, items: [{ medicineId: MED.PARACETAMOL, quantity: 3 }] }, "key-checkout-2")).toThrow(/different request/);
  });
  it("a failed checkout leaves nothing behind and the same key can be tried again", () => {
    const bad = { ...base, items: [{ medicineId: MED.PARACETAMOL, quantity: 100000 }] };
    const reserved = reservedOf("ph_1", MED.PARACETAMOL);
    expect(() => placeOrder(customer, bad, "key-checkout-3")).toThrow(/not available/);
    expect(db().orders.some((o) => o.idempotencyKey === "key-checkout-3")).toBe(false);
    expect(reservedOf("ph_1", MED.PARACETAMOL)).toBe(reserved);
    expect(db().idempotencyRecords.some((r) => r.key === "key-checkout-3")).toBe(false);
  });
  it("two customers racing for the last units: exactly one wins and nothing is oversold", async () => {
    // Leave exactly 3 units for sale at the pharmacy
    const rows = db().inventory.filter((i) => i.pharmacyId === "ph_1" && i.medicineId === MED.PARACETAMOL);
    rows.forEach((r, i) => { r.stockQuantity = i === 0 ? 3 : 0; r.reservedQuantity = 0; });
    const attempt = (u: SessionUser) => Promise.resolve().then(() => createOrder(u, { ...base, items: [{ medicineId: MED.PARACETAMOL, quantity: 2 }] }));
    const results = await Promise.allSettled([attempt(customer), attempt(customer2)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
    expect(reservedOf("ph_1", MED.PARACETAMOL)).toBe(2);
    expect(availOf("ph_1", MED.PARACETAMOL)).toBe(1);
  });
  it("the server decides price, fees, payment status and order status (nothing from the client is trusted)", async () => {
    await signIn("asha@example.com");
    const post = (await route("orders")).POST;
    const body = { pharmacyId: "ph_1", addressId: "ad_1", deliveryType: "NORMAL", paymentMethod: "UPI", items: [{ medicineId: MED.PARACETAMOL, quantity: 2 }] };
    for (const extra of [{ total: 1 }, { subtotal: 1 }, { deliveryFee: 0 }, { platformFee: 0 }, { paymentStatus: "PAID" }, { status: "CONFIRMED" }, { discount: 500 }, { pharmacyVerified: true }, { stockQuantity: 9999 }]) {
      expect((await call(post, "POST", "/api/orders", { body: { ...body, ...extra } })).status, JSON.stringify(extra)).toBe(400);
    }
    const ok = await call(post, "POST", "/api/orders", { body, headers: { "idempotency-key": "route-key-0001" } });
    expect(ok.status).toBe(201);
    expect(ok.body.data).toMatchObject({ status: "PENDING", paymentStatus: "PENDING", refundStatus: "NOT_REQUIRED" });
    const repeat = await call(post, "POST", "/api/orders", { body, headers: { "idempotency-key": "route-key-0001" } });
    expect(repeat.status).toBe(200);
    expect(repeat.body.data.id).toBe(ok.body.data.id);
    expect((await call(post, "POST", "/api/orders", { body, headers: { "idempotency-key": "x" } })).status).toBe(400); // malformed key
  });
  it("snapshots the fee, platform fee, discount and ETA range on the order", () => {
    settings().platformFee = 3;
    const o = otc(2);
    expect(o.platformFee).toBe(3);
    expect(o.total).toBe(o.subtotal + o.deliveryFee + o.platformFee - o.discount);
    expect(o.feeBreakdown).toBeTruthy();
    expect(o.etaRange![1]).toBeGreaterThan(o.etaRange![0]);
  });
  it("cash on delivery is limited by the configured maximum", () => {
    settings().codMaxAmount = 10;
    expect(() => otc(2)).toThrow(/Cash on delivery is available for orders up to/);
    expect(online(2).paymentMethod).toBe("UPI");
  });
});

// ───────────────────────── Fees and ETA ─────────────────────────

describe("delivery fee rules and ETA", () => {
  const addr = { pincode: "261001", town: "Sitapur", district: "Sitapur", state: "Uttar Pradesh" };
  it("a service-area rule gives base + per-km beyond the included distance, min and max, priority surcharge", () => {
    const area = db().serviceAreas.find((a) => a.pincode === "261001")!;
    area.feeRule = { baseFee: 20, includedDistanceKm: 2, perKmFee: 8, prioritySurcharge: 15, minFee: 25, maxFee: 80, maxServiceRadiusKm: 10 };
    const cfg = settings();
    expect(computeDeliveryFee({ subtotal: 100, type: "NORMAL", distanceKm: 1, address: addr, cfg }).fee).toBe(25); // minimum applies
    expect(computeDeliveryFee({ subtotal: 100, type: "NORMAL", distanceKm: 5, address: addr, cfg }).fee).toBe(44); // 20 + 3 km × 8
    expect(computeDeliveryFee({ subtotal: 100, type: "NORMAL", distanceKm: 9.5, address: addr, cfg }).fee).toBe(80); // capped
    expect(computeDeliveryFee({ subtotal: 100, type: "PRIORITY", distanceKm: 5, address: addr, cfg }).fee).toBe(59);
    expect(() => computeDeliveryFee({ subtotal: 100, type: "NORMAL", distanceKm: 12, address: addr, cfg })).toThrow(/We deliver up to 10 km/);
    const freeNormal = computeDeliveryFee({ subtotal: cfg.freeDeliveryAbove, type: "NORMAL", distanceKm: 5, address: addr, cfg });
    expect(freeNormal).toMatchObject({ fee: 0, breakdown: { freeDelivery: true, rule: "AREA" } });
  });
  it("without a rule the platform settings apply, and the order keeps the fee it was placed with", () => {
    const o = otc(1);
    expect(o.feeBreakdown?.rule).toBe("PLATFORM");
    const fee = o.deliveryFee;
    settings().normalDeliveryFee = fee + 40;
    expect(o.deliveryFee).toBe(fee);
  });
  it("ETA is a configurable range and gets longer for prescriptions, no riders and distance", () => {
    const i = { distanceKm: 3, prepMinutes: 10, needsPrescriptionReview: false, riderAvailable: true, deliveryType: "NORMAL" as const };
    const quick = estimateEta(i);
    expect(estimateEta({ ...i, needsPrescriptionReview: true }).minutes).toBeGreaterThan(quick.minutes);
    expect(estimateEta({ ...i, config: { riderAssignMinutes: 30 } }).minutes).toBeGreaterThan(quick.minutes);
    expect(quick.range[0]).toBeLessThanOrEqual(quick.minutes);
    expect(quick.range[1]).toBeGreaterThan(quick.range[0]);
    expect(quick.breakdown.map((b) => b.label)).toContain("Travel");
  });
});

// ───────────────────────── Order status and prescriptions ─────────────────────────

describe("order status and ownership", () => {
  it("rejects an invalid transition and writes no history for it", () => {
    const o = otc();
    const rows = db().orderStatusHistory.length;
    expect(() => transition(o, "DELIVERED", rider4)).toThrow(/cannot go from/);
    expect(() => transition(o, "PREPARING", pharmacist)).toThrow(/cannot go from/);
    expect(() => transition(o, "CONFIRMED", customer)).toThrow(/cannot go from/); // the customer cannot confirm their own order
    expect(db().orderStatusHistory.length).toBe(rows);
  });
  it("a pharmacy can only act on its own orders", () => {
    const o = otc();
    expect(() => advanceAsPharmacy(otherPharmacy, o.id, "confirm")).toThrow(/access/);
    expect(() => rejectOrder(otherPharmacy, o.id, "no")).toThrow(/access/);
    expect(() => decideCancellation(otherPharmacy, o.id, "APPROVE")).toThrow(/access/);
    expect(o.status).toBe("PENDING");
  });
  it("an online order cannot be confirmed before it is paid", () => {
    const o = online();
    expect(() => step(o, "confirm")).toThrow(/payment/);
    capture(o);
    step(o, "confirm");
    expect(o.status).toBe("CONFIRMED");
  });
  it("a prescription order goes to review, is approved, then confirmed; rejection cancels, frees stock and refunds", () => {
    const rx = storePrescription({ userId: customer.id, file: rxFile, requestedMedicines: [], source: "UPLOAD" });
    const items = [{ medicineId: MED.METFORMIN, quantity: 1 }];
    const o = createOrder(customer, { ...base, paymentMethod: "UPI", prescriptionId: rx.id, items });
    expect(o.status).toBe("PRESCRIPTION_REVIEW");
    capture(o);
    reviewOrderPrescription(pharmacist, o.id, "APPROVE");
    expect(o.status).toBe("PRESCRIPTION_APPROVED");
    step(o, "confirm");
    expect(o.status).toBe("CONFIRMED");

    const rx2 = storePrescription({ userId: customer.id, file: rxFile, requestedMedicines: [], source: "UPLOAD" });
    const reserved = reservedOf("ph_1", MED.METFORMIN);
    const o2 = createOrder(customer, { ...base, paymentMethod: "UPI", prescriptionId: rx2.id, items });
    capture(o2);
    expect(reservedOf("ph_1", MED.METFORMIN)).toBe(reserved + 1);
    reviewOrderPrescription(pharmacist, o2.id, "REJECT", "Unreadable");
    expect(o2).toMatchObject({ status: "CANCELLED", cancelReasonCode: "PRESCRIPTION_REJECTED", paymentStatus: "REFUNDED", refundStatus: "COMPLETED" });
    expect(reservedOf("ph_1", MED.METFORMIN)).toBe(reserved);
    expect(db().notifications.some((n) => n.userId === customer.id && n.event === "PRESCRIPTION_REJECTED")).toBe(true);
  });
  it("sends the customer the right notification at each step, with no medicine names", () => {
    const o = ready();
    acceptDelivery(rider4, o.id); riderStep(rider4, o.id, "PICKUP", pickup(o.id)); riderStep(rider4, o.id, "START"); finish(o);
    const events = db().notifications.filter((n) => n.userId === customer.id).map((n) => n.event);
    for (const e of ["ORDER_PLACED", "ORDER_CONFIRMED", "ORDER_PREPARING", "ORDER_READY", "RIDER_ASSIGNED", "OUT_FOR_DELIVERY", "ORDER_DELIVERED"]) expect(events, e).toContain(e);
    expect(JSON.stringify(db().notifications.filter((n) => n.userId === customer.id).map((n) => n.body))).not.toMatch(/Paracetamol/i);
  });
});

// ───────────────────────── Payments ─────────────────────────

describe("payments and the webhook", () => {
  it("an online order starts PENDING with one attempt; only a signed webhook makes it PAID", () => {
    const o = online();
    expect(pay(o.id)).toMatchObject({ status: "PENDING", method: "UPI", provider: "MOCK", currency: "INR", refundedAmount: 0, amount: o.total });
    expect(attemptsOf(pay(o.id).id)).toHaveLength(1);
    expect(() => webhook({ eventId: "e1", type: "PAYMENT_CAPTURED", providerOrderId: pay(o.id).providerOrderId, amountPaise: toPaise(o.total) }, false)).toThrow(/Invalid signature/);
    expect(o.paymentStatus).toBe("PENDING");
    expect(capture(o)).toMatchObject({ handled: true });
    expect(o).toMatchObject({ paymentStatus: "PAID" });
    expect(pay(o.id)).toMatchObject({ status: "PAID" });
    expect(pay(o.id).paidAt).toBeTruthy();
    expect(pay(o.id).providerPaymentId).toBeTruthy();
    expect(db().notifications.some((n) => n.event === "PAYMENT_RECEIVED" && n.userId === customer.id)).toBe(true);
    expect(o.paymentExpiresAt).toBeUndefined();
  });
  it("the signature covers the body: changing a byte after signing is refused", () => {
    const o = online();
    const a = attemptsOf(pay(o.id).id)[0];
    const raw = JSON.stringify({ eventId: "e2", type: "PAYMENT_CAPTURED", providerOrderId: a.providerOrderId, amountPaise: toPaise(o.total) });
    const sig = signMockWebhook(raw);
    expect(() => processWebhook(raw.replace(String(toPaise(o.total)), "100"), sig, "MOCK")).toThrow(/Invalid signature/);
    expect(() => processWebhook(raw, null, "MOCK")).toThrow(/Invalid signature/);
    expect(o.paymentStatus).toBe("PENDING");
  });
  it("a duplicate webhook is acknowledged but processed once", () => {
    const o = online();
    const a = attemptsOf(pay(o.id).id)[0];
    const body = { eventId: "evt_same", type: "PAYMENT_CAPTURED", providerOrderId: a.providerOrderId, providerPaymentId: "pp_1", amountPaise: toPaise(o.total) };
    expect(webhook(body)).toMatchObject({ handled: true });
    const notified = db().notifications.filter((n) => n.event === "PAYMENT_RECEIVED").length;
    expect(webhook(body)).toMatchObject({ handled: false, duplicate: true });
    expect(db().notifications.filter((n) => n.event === "PAYMENT_RECEIVED").length).toBe(notified);
    expect(attemptsOf(pay(o.id).id).filter((x) => x.status === "SUCCEEDED")).toHaveLength(1);
  });
  it("a different event for an already-paid attempt is also harmless", () => {
    const o = online();
    capture(o, {}, "evt_a");
    expect(capture(o, {}, "evt_b")).toMatchObject({ handled: false, duplicate: true });
    expect(pay(o.id).status).toBe("PAID");
  });
  it("amount tampering is refused: the order is not marked paid and support is alerted", () => {
    const o = online();
    const a = attemptsOf(pay(o.id).id)[0];
    const r = webhook({ eventId: "evt_cheap", type: "PAYMENT_CAPTURED", providerOrderId: a.providerOrderId, providerPaymentId: "pp_x", amountPaise: 100 });
    expect(r).toMatchObject({ handled: false, rejected: "AMOUNT_MISMATCH" });
    expect(o.paymentStatus).toBe("PENDING");
    expect(attemptsOf(pay(o.id).id)[0]).toMatchObject({ status: "FAILED", failureCode: "AMOUNT_MISMATCH" });
    expect(db().audit.some((x) => x.action === "PAYMENT_AMOUNT_MISMATCH")).toBe(true);
    expect(db().notifications.some((n) => n.event === "SUPPORT_ALERT" && n.title.includes("mismatch"))).toBe(true);
  });
  it("a webhook for a payment we do not know is ignored without error", () => {
    expect(webhook({ eventId: "evt_ghost", type: "PAYMENT_CAPTURED", providerOrderId: "nope", amountPaise: 100 })).toMatchObject({ handled: false, ignored: "UNKNOWN_PAYMENT" });
  });
  it("failed payment: the order stays, the customer is told, and the reservation is held for the window", () => {
    const o = online();
    failPayment(customer, o.id);
    expect(o).toMatchObject({ status: "PENDING", paymentStatus: "FAILED", stockState: "RESERVED" });
    expect(attemptsOf(pay(o.id).id)[0]).toMatchObject({ status: "FAILED", failureCode: "USER_CANCELLED" });
    expect(db().notifications.some((n) => n.event === "PAYMENT_FAILED" && n.userId === customer.id)).toBe(true);
    expect(() => step(o, "confirm")).toThrow(/payment/);
  });
  it("retry opens a second attempt on the SAME order and payment, and payment then succeeds", () => {
    const o = online();
    failPayment(customer, o.id);
    const orders = db().orders.length;
    const v = retryPayment(customer, o.id);
    expect(v).toMatchObject({ status: "PENDING", attempts: 2 });
    expect(v.checkout?.providerOrderId).toBeTruthy();
    expect(db().orders.length).toBe(orders);
    expect(db().payments.filter((p) => p.orderId === o.id)).toHaveLength(1);
    expect(attemptsOf(pay(o.id).id).map((a) => a.attemptNumber)).toEqual([1, 2]);
    expect(retryPayment(customer, o.id).attempts).toBe(2); // pressing retry again does not open a third attempt
    confirmPayment(customer, o.id);
    expect(o.paymentStatus).toBe("PAID");
  });
  it("create-payment is repeatable while an attempt is open and refused for cash orders", () => {
    const o = online();
    const a = createPaymentForOrder(customer, o.id);
    const b = createPaymentForOrder(customer, o.id);
    expect(b.checkout?.providerOrderId).toBe(a.checkout?.providerOrderId);
    expect(() => createPaymentForOrder(customer2, o.id)).toThrow(/not found/i);
    expect(() => createPaymentForOrder(customer, otc().id)).toThrow(/Cash on Delivery/);
  });
  it("after a failure the customer can switch to cash on delivery (when eligible)", () => {
    const o = online();
    failPayment(customer, o.id);
    retryPayment(customer, o.id, { method: "COD" });
    expect(o).toMatchObject({ paymentMethod: "COD", paymentStatus: "PENDING" });
    expect(pay(o.id)).toMatchObject({ method: "COD", provider: "COD" });
    expect(attemptsOf(pay(o.id).id).every((a) => a.status !== "PENDING")).toBe(true);
    step(o, "confirm"); // COD orders do not wait for payment
    expect(o.status).toBe("CONFIRMED");
    const big = online(2);
    settings().codMaxAmount = 5;
    expect(() => retryPayment(customer, big.id, { method: "COD" })).toThrow(/up to/);
  });
  it("money that arrives after the order was switched to cash on delivery is sent straight back", () => {
    const o = online();
    const a = attemptsOf(pay(o.id).id)[0];
    retryPayment(customer, o.id, { method: "COD" });
    webhook({ eventId: "evt_late1", type: "PAYMENT_CAPTURED", providerOrderId: a.providerOrderId, providerPaymentId: "pp_late", amountPaise: toPaise(o.total) });
    expect(o.paymentStatus).toBe("PENDING");
    expect(db().refunds.find((r) => r.orderId === o.id)).toMatchObject({ status: "COMPLETED", amount: o.total, actorRole: "SYSTEM" });
  });
  it("money that arrives after the order was cancelled is refunded", () => {
    const o = online();
    const a = attemptsOf(pay(o.id).id)[0];
    cancelOrder(customer, o.id, { reasonCode: "CHANGED_MIND" });
    expect(pay(o.id).status).toBe("FAILED");
    webhook({ eventId: "evt_late2", type: "PAYMENT_CAPTURED", providerOrderId: a.providerOrderId, providerPaymentId: "pp_late2", amountPaise: toPaise(o.total) });
    expect(o).toMatchObject({ status: "CANCELLED", paymentStatus: "REFUNDED", refundStatus: "COMPLETED" });
  });
  it("the webhook route is public but signature-guarded, and the client can never declare a payment paid", async () => {
    const o = online();
    const a = attemptsOf(pay(o.id).id)[0];
    const hook = (await route("payments/webhook")).POST;
    const raw = JSON.stringify({ eventId: "evt_route", type: "PAYMENT_CAPTURED", providerOrderId: a.providerOrderId, providerPaymentId: "pp_r", amountPaise: toPaise(o.total) });
    const send = (headers: Record<string, string>) => hook(new Request("http://localhost/api/payments/webhook", { method: "POST", body: raw, headers }), { params: Promise.resolve({}) });
    expect((await send({})).status).toBe(401);
    expect((await send({ "x-signature": "00" })).status).toBe(401);
    expect(o.paymentStatus).toBe("PENDING");
    expect((await send({ "x-signature": signMockWebhook(raw) })).status).toBe(200);
    expect(o.paymentStatus).toBe("PAID");
    // the old browser-driven "pay" action no longer exists
    await signIn("asha@example.com");
    const other = online();
    expect((await call((await route("orders/[id]")).POST, "POST", "/x", { params: { id: other.id }, body: { action: "pay", providerRef: "demo_123" } })).status).toBe(400);
    expect(other.paymentStatus).toBe("PENDING");
  });
  it("payment status is visible to the owner, pharmacy staff and admin only, and staff never see gateway handles", async () => {
    const o = online();
    const p = pay(o.id);
    expect(getPaymentFor(customer, p.id).checkout).toBeTruthy();
    expect(getPaymentFor(pharmacist, p.id).checkout).toBeUndefined();
    expect(getPaymentFor(admin, p.id).id).toBe(p.id);
    expect(() => getPaymentFor(customer2, p.id)).toThrow(/access/);
    expect(() => getPaymentFor(otherPharmacy, p.id)).toThrow(/access/);
  });
  it("COD is never marked paid at checkout; only the rider's cash collection does it", () => {
    const o = ready();
    expect(pay(o.id)).toMatchObject({ method: "COD", provider: "COD", status: "PENDING" });
    pickedUp(o);
    expect(pay(o.id).status).toBe("PENDING");
    expect(() => riderStep(rider4, o.id, "DELIVER", dcode(o.id))).toThrow(/Collect ₹/);
    expect(() => riderStep(rider4, o.id, "DELIVER", dcode(o.id), { cashCollected: o.total - 1 })).toThrow(/Collect ₹/);
    finish(o);
    expect(o).toMatchObject({ status: "DELIVERED", paymentStatus: "PAID" });
    expect(pay(o.id)).toMatchObject({ status: "PAID", codCollectedAmount: o.total });
    expect(latestDelivery(o)).toMatchObject({ status: "DELIVERED", cashCollectedAmount: o.total });
  });
});

// ───────────────────────── Cancellation and refunds ─────────────────────────

describe("cancellation", () => {
  it("is immediate before preparation: stock goes back, reason and actor are recorded, and it is audited with before/after", () => {
    const reserved = reservedOf("ph_1", MED.PARACETAMOL);
    const o = otc(2);
    cancelOrder(customer, o.id, { reasonCode: "TOO_SLOW", note: "Waited long" });
    expect(o).toMatchObject({ status: "CANCELLED", cancelReasonCode: "TOO_SLOW", cancelledBy: "CUSTOMER", cancelledByUserId: customer.id, stockState: "RELEASED" });
    expect(o.cancelledAt).toBeTruthy();
    expect(reservedOf("ph_1", MED.PARACETAMOL)).toBe(reserved);
    const log = db().audit.find((a) => a.action === "ORDER_CANCELLED" && a.targetId === o.id)!;
    expect(log).toMatchObject({ actorId: customer.id, actorRole: "CUSTOMER", targetType: "Order" });
    expect(log.before).toMatchObject({ status: "PENDING" });
    expect(log.after).toMatchObject({ status: "CANCELLED" });
    expect(db().notifications.some((n) => n.event === "ORDER_CANCELLED" && n.userId === customer.id)).toBe(true);
  });
  it("after a confirmed order, cancelling puts the consumed units back on the shelf", () => {
    const before = stockOf("ph_1", MED.PARACETAMOL);
    const o = otc(2);
    step(o, "confirm");
    expect(stockOf("ph_1", MED.PARACETAMOL)).toBe(before - 2);
    cancelOrder(customer, o.id, { reasonCode: "CHANGED_MIND" });
    expect(stockOf("ph_1", MED.PARACETAMOL)).toBe(before);
  });
  it("once the pharmacy is preparing, the customer only asks; the pharmacy approves or declines", () => {
    const o = otc(2); step(o, "confirm"); step(o, "prepare");
    cancelOrder(customer, o.id, { reasonCode: "CHANGED_MIND" });
    expect(o.status).toBe("PREPARING");
    expect(o.cancellationRequest).toMatchObject({ status: "PENDING", reasonCode: "CHANGED_MIND" });
    cancelOrder(customer, o.id, { reasonCode: "CHANGED_MIND" }); // asking twice is harmless
    expect(db().audit.filter((a) => a.action === "ORDER_CANCEL_REQUESTED" && a.targetId === o.id)).toHaveLength(1);
    expect(() => decideCancellation(pharmacist, o.id, "REJECT")).toThrow(/tell the customer why/);
    decideCancellation(pharmacist, o.id, "REJECT", "Already packed");
    expect(o).toMatchObject({ status: "PREPARING" });
    expect(o.cancellationRequest!.status).toBe("REJECTED");
    cancelOrder(customer, o.id, { reasonCode: "OTHER", note: "Please" });
    decideCancellation(pharmacist, o.id, "APPROVE");
    expect(o.status).toBe("CANCELLED");
    expect(o.cancelReasonCode).toBe("OTHER");
  });
  it("the pharmacy and support can cancel directly before pickup", () => {
    const a = otc(1); step(a, "confirm"); step(a, "prepare");
    rejectOrder(pharmacist, a.id, "Out of stock");
    expect(a.status).toBe("CANCELLED");
    const b = ready();
    cancelOrder(admin, b.id, { reasonCode: "OTHER", note: "Support request" });
    expect(b).toMatchObject({ status: "CANCELLED", cancelledBy: "SUPER_ADMIN" });
  });
  it("after pickup nobody can cancel from the app, whoever they are", () => {
    const o = pickedUp();
    expect(() => cancelOrder(customer, o.id, { reasonCode: "CHANGED_MIND" })).toThrow(/on its way/);
    expect(() => cancelOrder(admin, o.id, { reasonCode: "OTHER", note: "x" })).toThrow(/failed-delivery and return|left the pharmacy/);
    expect(() => rejectOrder(pharmacist, o.id, "no")).toThrow(/out for delivery/);
    expect(() => transition(o, "CANCELLED", "SYSTEM")).toThrow();
    expect(o.status).toBe("OUT_FOR_DELIVERY");
  });
  it("a closed order cannot be cancelled again", () => {
    const o = otc(); cancelOrder(customer, o.id, { reasonCode: "CHANGED_MIND" });
    expect(() => cancelOrder(customer, o.id, { reasonCode: "CHANGED_MIND" })).toThrow(/closed/);
  });
  it("a customer cannot cancel someone else's order", () => {
    const o = otc();
    expect(() => cancelOrder(customer2, o.id, { reasonCode: "CHANGED_MIND" })).toThrow(/access/);
  });
  it("the matrix is data: customers ask from PREPARING, nobody cancels after pickup, support only once the parcel is returned", () => {
    const m = Object.fromEntries(CANCELLATION_MATRIX.map((r) => [r.status, r]));
    expect(m.CONFIRMED).toMatchObject({ customer: "ALLOW", pharmacy: "ALLOW", support: "ALLOW" });
    expect(m.PREPARING).toMatchObject({ customer: "REQUEST", pharmacy: "ALLOW" });
    expect(m.OUT_FOR_DELIVERY).toMatchObject({ customer: "DENY", pharmacy: "DENY", support: "DENY" });
    expect(m.DELIVERED.customer).toBe("DENY");
    expect(cancellationRule({ status: "OUT_FOR_DELIVERY" }, "SUPER_ADMIN", { status: "RETURNED_TO_PHARMACY" }).decision).toBe("ALLOW");
    expect(cancellationRule({ status: "OUT_FOR_DELIVERY" }, "SUPER_ADMIN", { status: "DELIVERY_FAILED" }).decision).toBe("DENY");
  });
  it("online orders that nobody paid or confirmed in time release their stock (by the configured window)", () => {
    const reserved = reservedOf("ph_1", MED.PARACETAMOL);
    settings().paymentWindowMinutes = 10;
    const o = online(2);
    expect(reservedOf("ph_1", MED.PARACETAMOL)).toBe(reserved + 2);
    expect(expireReservations(Date.now() + 9 * 60_000)).toBe(0);
    expect(runOrderHousekeeping(Date.now() + 11 * 60_000)).toBeGreaterThanOrEqual(1);
    expect(o).toMatchObject({ status: "CANCELLED", cancelReasonCode: "PAYMENT_ISSUE", stockState: "RELEASED" });
    expect(reservedOf("ph_1", MED.PARACETAMOL)).toBe(reserved);
  });
  it("a failed payment does not extend the reservation: the window is fixed at checkout", () => {
    const o = online(2);
    const deadline = o.reservationExpiresAt;
    failPayment(customer, o.id);
    retryPayment(customer, o.id);
    expect(o.reservationExpiresAt).toBe(deadline);
    expireReservations(Date.parse(deadline!) + 1000);
    expect(o.status).toBe("CANCELLED");
    expect(() => retryPayment(customer, o.id)).toThrow();
  });
});

describe("refunds", () => {
  it("cancelling a paid order refunds it in full, once, and the customer can see the status", () => {
    const o = online(); capture(o);
    cancelOrder(customer, o.id, { reasonCode: "CHANGED_MIND" });
    expect(db().refunds.filter((r) => r.orderId === o.id)).toHaveLength(1);
    expect(db().refunds[0]).toMatchObject({ amount: o.total, kind: "FULL", status: "COMPLETED", idempotencyKey: `cancel:${o.id}` });
    expect(pay(o.id)).toMatchObject({ status: "REFUNDED", refundedAmount: o.total });
    expect(o).toMatchObject({ paymentStatus: "REFUNDED", refundStatus: "COMPLETED" });
    const view = userSafeOrder(o, customer) as { payment: { refunds: unknown[]; refundStatus: string } };
    expect(view.payment.refundStatus).toBe("COMPLETED");
    expect(view.payment.refunds).toHaveLength(1);
    expect(db().notifications.filter((n) => n.userId === customer.id).map((n) => n.event)).toEqual(expect.arrayContaining(["REFUND_INITIATED", "REFUND_COMPLETED"]));
  });
  it("is idempotent: the same key never refunds twice, a different key cannot exceed what was paid", () => {
    const o = online(); capture(o);
    const p = pay(o.id);
    const a = adminRefund(admin, p.id, { amount: 10, reason: "Goodwill", key: "refund-key-1" });
    const b = adminRefund(admin, p.id, { amount: 10, reason: "Goodwill", key: "refund-key-1" });
    expect(b.id).toBe(a.id);
    expect(db().refunds.filter((r) => r.paymentId === p.id)).toHaveLength(1);
    expect(p.refundedAmount).toBe(10);
    expect(p.status).toBe("PARTIALLY_REFUNDED");
    expect(() => adminRefund(admin, p.id, { amount: 11, reason: "Different", key: "refund-key-1" })).toThrow(/different refund/);
    expect(() => adminRefund(admin, p.id, { amount: o.total, reason: "Too much", key: "refund-key-2" })).toThrow(/Only/);
    adminRefund(admin, p.id, { reason: "The rest", key: "refund-key-3" });
    expect(p).toMatchObject({ status: "REFUNDED", refundedAmount: o.total });
    expect(() => adminRefund(admin, p.id, { amount: 1, reason: "Again", key: "refund-key-4" })).toThrow(/no money|nothing left/);
    expect(o.refundStatus).toBe("COMPLETED");
  });
  it("a slow gateway keeps the refund PROCESSING until its webhook says it is done", () => {
    mockGateway.refund = "PROCESSING";
    const o = online(); capture(o);
    cancelOrder(customer, o.id, { reasonCode: "CHANGED_MIND" });
    const rf = db().refunds[0];
    expect(rf.status).toBe("PROCESSING");
    expect(o.refundStatus).toBe("PROCESSING");
    expect(pay(o.id).status).toBe("PAID");
    webhook({ eventId: "evt_rf1", type: "REFUND_PROCESSED", providerRefundId: rf.providerRefundId });
    expect(rf.status).toBe("COMPLETED");
    expect(o).toMatchObject({ paymentStatus: "REFUNDED", refundStatus: "COMPLETED" });
    expect(webhook({ eventId: "evt_rf1", type: "REFUND_PROCESSED", providerRefundId: rf.providerRefundId })).toMatchObject({ duplicate: true });
    expect(pay(o.id).refundedAmount).toBe(o.total);
  });
  it("a failed refund is visible, alerts support, and the same key can retry it", () => {
    mockGateway.refund = "FAILED";
    const o = online(); capture(o);
    cancelOrder(customer, o.id, { reasonCode: "CHANGED_MIND" });
    const rf = db().refunds[0];
    expect(rf.status).toBe("FAILED");
    expect(o.refundStatus).toBe("FAILED");
    expect(pay(o.id).refundedAmount).toBe(0);
    expect(db().notifications.some((n) => n.event === "REFUND_FAILED")).toBe(true);
    expect(db().audit.some((a) => a.action === "REFUND_FAILED")).toBe(true);
    mockGateway.reset();
    adminRefund(admin, pay(o.id).id, { reason: "Retry", key: rf.idempotencyKey });
    expect(db().refunds).toHaveLength(1);
    expect(rf.status).toBe("COMPLETED");
    expect(deriveRefundStatus(o.id)).toBe("COMPLETED");
  });
  it("cash orders have nothing to refund and unpaid online orders just close their payment", () => {
    const c = otc(); cancelOrder(customer, c.id, { reasonCode: "CHANGED_MIND" });
    expect(db().refunds.filter((r) => r.orderId === c.id)).toHaveLength(0);
    expect(c.refundStatus).toBe("NOT_REQUIRED");
    const u = online(); cancelOrder(customer, u.id, { reasonCode: "CHANGED_MIND" });
    expect(db().refunds.filter((r) => r.orderId === u.id)).toHaveLength(0);
    expect(pay(u.id).status).toBe("FAILED");
    expect(() => adminRefund(admin, pay(u.id).id, { reason: "Nothing paid", key: "refund-key-9" })).toThrow(/no money/);
  });
  it("refund routes need an elevated admin and an Idempotency-Key", async () => {
    const o = online(); capture(o);
    const refund = (await route("admin/payments/[id]/refund")).POST;
    await signIn("asha@example.com");
    expect((await call(refund, "POST", "/x", { params: { id: pay(o.id).id }, body: { reason: "Mine" }, headers: { "idempotency-key": "route-refund-1" } })).status).toBe(403);
    await signIn("admin@example.com", { elevate: false });
    expect((await call(refund, "POST", "/x", { params: { id: pay(o.id).id }, body: { reason: "x ok" }, headers: { "idempotency-key": "route-refund-1" } })).body.errors?.[0].code).toBe("ELEVATION_REQUIRED");
    await signIn("admin@example.com");
    expect((await call(refund, "POST", "/x", { params: { id: pay(o.id).id }, body: { reason: "No key" } })).status).toBe(400);
    const ok = await call(refund, "POST", "/x", { params: { id: pay(o.id).id }, body: { reason: "Support", amount: 5 }, headers: { "idempotency-key": "route-refund-1" } });
    expect(ok.status).toBe(200);
    const again = await call(refund, "POST", "/x", { params: { id: pay(o.id).id }, body: { reason: "Support", amount: 5 }, headers: { "idempotency-key": "route-refund-1" } });
    expect(again.body.data.id).toBe(ok.body.data.id);
    expect(db().refunds.filter((r) => r.paymentId === pay(o.id).id)).toHaveLength(1);
  });
});

// ───────────────────────── Partial fulfilment ─────────────────────────

describe("partial fulfilment", () => {
  const two = (method: "COD" | "UPI") => createOrder(customer, { ...base, paymentMethod: method, items: [{ medicineId: MED.PARACETAMOL, quantity: 2 }, { medicineId: MED.ORS, quantity: 1 }] });
  it("never removes anything silently: the customer must answer, and the pharmacy is blocked meanwhile", () => {
    const o = two("COD");
    const gone = o.items.find((i) => i.medicineId === MED.ORS)!;
    proposePartialFulfillment(pharmacist, o.id, [{ itemId: gone.id, reason: "Out of stock" }]);
    expect(o.items).toHaveLength(2);
    expect(o.partialFulfillment).toMatchObject({ status: "PENDING_CUSTOMER", unavailable: [{ itemId: gone.id, reason: "Out of stock" }] });
    expect(o.partialFulfillment!.proposed.total).toBeLessThan(o.total);
    expect(() => step(o, "confirm")).toThrow(/Waiting for the customer/);
    expect(db().notifications.some((n) => n.event === "ORDER_PARTIAL_PROPOSED" && n.userId === customer.id)).toBe(true);
  });
  it("CONTINUE recomputes totals on the server, releases only the removed units and keeps the rest reserved", () => {
    const orsReserved = reservedOf("ph_1", MED.ORS), pcmReserved = reservedOf("ph_1", MED.PARACETAMOL);
    const o = two("COD");
    const gone = o.items.find((i) => i.medicineId === MED.ORS)!;
    const oldTotal = o.total;
    proposePartialFulfillment(pharmacist, o.id, [{ itemId: gone.id, reason: "Out of stock" }]);
    decidePartialFulfillment(customer, o.id, "CONTINUE");
    expect(o.items.map((i) => i.medicineId)).toEqual([MED.PARACETAMOL]);
    expect(o.removedItems).toHaveLength(1);
    expect(o.subtotal).toBe(o.items[0].unitPrice * 2);
    expect(o.total).toBe(o.subtotal + o.deliveryFee + o.platformFee - o.discount);
    expect(o.total).toBeLessThan(oldTotal);
    expect(reservedOf("ph_1", MED.ORS)).toBe(orsReserved);
    expect(reservedOf("ph_1", MED.PARACETAMOL)).toBe(pcmReserved + 2);
    expect(pay(o.id).amount).toBe(o.total);
    expect(o.partialFulfillment!.status).toBe("ACCEPTED");
    expect(decidePartialFulfillment(customer, o.id, "CONTINUE")).toBe(o); // answering twice is harmless
    step(o, "confirm");
    expect(o.status).toBe("CONFIRMED");
    expect(db().audit.find((a) => a.action === "PARTIAL_FULFILLMENT_ACCEPTED")!.before).toMatchObject({ total: oldTotal });
  });
  it("for a prepaid order the difference is refunded as a partial refund, once", () => {
    const o = two("UPI"); capture(o);
    const paid = o.total;
    const gone = o.items.find((i) => i.medicineId === MED.ORS)!;
    proposePartialFulfillment(pharmacist, o.id, [{ itemId: gone.id, reason: "Expired batch" }]);
    decidePartialFulfillment(customer, o.id, "CONTINUE");
    const rf = db().refunds.filter((r) => r.orderId === o.id);
    expect(rf).toHaveLength(1);
    expect(rf[0]).toMatchObject({ kind: "PARTIAL", amount: paid - o.total, status: "COMPLETED" });
    expect(pay(o.id)).toMatchObject({ status: "PARTIALLY_REFUNDED", refundedAmount: paid - o.total });
    expect(o.refundStatus).toBe("PARTIAL");
    expect(db().refunds).toHaveLength(1);
  });
  it("CANCEL (or no answer in time) cancels the whole order, releases all stock and refunds", () => {
    const reserved = reservedOf("ph_1", MED.PARACETAMOL);
    const o = two("UPI"); capture(o);
    const gone = o.items.find((i) => i.medicineId === MED.ORS)!;
    proposePartialFulfillment(pharmacist, o.id, [{ itemId: gone.id, reason: "Out of stock" }]);
    decidePartialFulfillment(customer, o.id, "CANCEL");
    expect(o).toMatchObject({ status: "CANCELLED", cancelReasonCode: "CUSTOMER_DECLINED_PARTIAL", paymentStatus: "REFUNDED" });
    expect(reservedOf("ph_1", MED.PARACETAMOL)).toBe(reserved);

    const p = two("COD");
    const g2 = p.items[1];
    proposePartialFulfillment(pharmacist, p.id, [{ itemId: g2.id, reason: "Out of stock" }]);
    settings().partialProposalMinutes = 15;
    expect(expirePartialProposals(Date.now() + 60_000)).toBe(0);
    p.partialFulfillment!.expiresAt = new Date(Date.now() - 1000).toISOString();
    expect(runOrderHousekeeping()).toBeGreaterThanOrEqual(1);
    expect(p).toMatchObject({ status: "CANCELLED", cancelReasonCode: "NO_RESPONSE" });
    expect(p.partialFulfillment!.status).toBe("EXPIRED");
  });
  it("rules: pharmacy only, own orders, a real item, not everything, not before payment, one open proposal", () => {
    const o = two("UPI");
    const [a, b] = o.items;
    expect(() => proposePartialFulfillment(pharmacist, o.id, [{ itemId: a.id, reason: "x ok" }])).toThrow(/payment/);
    capture(o);
    expect(() => proposePartialFulfillment(otherPharmacy, o.id, [{ itemId: a.id, reason: "x ok" }])).toThrow(/access/);
    expect(() => proposePartialFulfillment(pharmacist, o.id, [{ itemId: "nope", reason: "x ok" }])).toThrow(/not in this order/);
    expect(() => proposePartialFulfillment(pharmacist, o.id, [{ itemId: a.id, reason: "x ok" }, { itemId: b.id, reason: "x ok" }])).toThrow(/reject the order/);
    proposePartialFulfillment(pharmacist, o.id, [{ itemId: a.id, reason: "x ok" }]);
    expect(() => proposePartialFulfillment(pharmacist, o.id, [{ itemId: b.id, reason: "x ok" }])).toThrow(/not answered/);
    expect(() => decidePartialFulfillment(customer2, o.id, "CONTINUE")).toThrow(/access/);
  });
});

// ───────────────────────── Delivery ─────────────────────────

describe("delivery creation and rider assignment", () => {
  it("a delivery is created once when the order is READY_FOR_PICKUP, with hashed codes and an earning split", () => {
    const o = otc(2); step(o, "confirm"); step(o, "prepare");
    expect(db().deliveries.some((d) => d.orderId === o.id)).toBe(false);
    step(o, "ready");
    const dl = deliveryOf(o)!;
    expect(dl).toMatchObject({ status: "WAITING_FOR_RIDER", attemptNo: 1, cashToCollect: o.total });
    expect(dl.pickupOtpHash).toMatch(/^[0-9a-f]{64}$/);
    expect(dl.deliveryOtpHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(dl)).not.toContain(codeFor(dl, "PICKUP") === codeFor(dl, "DELIVERY") ? "never" : `"${codeFor(dl, "PICKUP")}"`);
    expect(dl.earning!.base + dl.earning!.distance + dl.earning!.incentive).toBe(dl.payout);
    expect(db().deliveries.filter((d) => d.orderId === o.id)).toHaveLength(1);
  });
  it("two riders accepting at the same moment: exactly one gets it", async () => {
    db().deliveryPartners.find((p) => p.id === "dp_3")!.available = true;
    const o = ready();
    const go = (u: SessionUser) => Promise.resolve().then(() => acceptDelivery(u, o.id));
    const r = await Promise.allSettled([go(rider4), go(rider3)]);
    expect(r.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    expect(r.filter((x) => x.status === "rejected")).toHaveLength(1);
    expect(deliveryOf(o)!.partnerId).toBe(o.deliveryPartnerId);
    expect(db().orderStatusHistory.filter((h) => h.orderId === o.id && h.toStatus === "RIDER_ASSIGNED")).toHaveLength(1);
  });
  it("the same rider tapping accept twice is safe", () => {
    const o = ready();
    acceptDelivery(rider4, o.id);
    expect(acceptDelivery(rider4, o.id).id).toBe(o.id);
    expect(db().orderStatusHistory.filter((h) => h.orderId === o.id && h.toStatus === "RIDER_ASSIGNED")).toHaveLength(1);
  });
  it("only APPROVED, available, in-area, not-busy riders may accept", () => {
    const o = ready();
    expect(() => acceptDelivery(rider3, o.id)).toThrow(/online/); // offline
    expect(() => acceptDelivery({ id: "u_dp5", name: "A", role: "DELIVERY_PARTNER", partnerId: "dp_5" }, o.id)).toThrow(/verified/);
    const dp4 = db().deliveryPartners.find((p) => p.id === "dp_4")!;
    dp4.servicePincodes = ["999999"];
    expect(() => acceptDelivery(rider4, o.id)).toThrow(/outside your service area/);
    expect(availableDeliveries(rider4)).toHaveLength(0);
    dp4.servicePincodes = [o.addressSnapshot.pincode];
    acceptDelivery(rider4, o.id);
    const second = ready();
    expect(() => acceptDelivery(rider4, second.id)).toThrow(/current delivery/); // busy: one at a time by default
    settings().maxConcurrentDeliveries = 2;
    acceptDelivery(rider4, second.id);
  });
  it("an offer shows pickup, area, distance and earning: no medicine, prescription, patient or street address", () => {
    const o = ready();
    const offers = availableDeliveries(rider4);
    const offer = offers.find((j) => j.id === o.id)!;
    expect(offer).toMatchObject({ pickup: { name: expect.any(String) }, dropArea: expect.any(String), estimatedEarning: expect.any(Number) });
    expect(offer.distanceKm).toBeDefined();
    const json = JSON.stringify(offer);
    expect(json).not.toMatch(/Paracetamol|prescription|allerg|houseDescription|contactName|contactMobile|Asha/i);
    expect(json).not.toContain(o.addressSnapshot.houseDescription);
  });
});

describe("pickup and delivery codes", () => {
  it("pickup needs the right code, counts wrong guesses (even though the call fails) and locks after five", () => {
    const o = ready(); acceptDelivery(rider4, o.id);
    const dl = deliveryOf(o)!;
    for (let i = 0; i < 5; i++) expect(() => riderStep(rider4, o.id, "PICKUP", "0000")).toThrow(/Pickup code/);
    expect(dl.pickupAttempts).toBe(5);
    expect(() => riderStep(rider4, o.id, "PICKUP", pickup(o.id))).toThrow(/Too many wrong/);
    expect(o.status).toBe("RIDER_ASSIGNED");
    expect(db().audit.filter((a) => a.action === "PICKUP_OTP_FAILED")).toHaveLength(5);
    // the pharmacy can issue a new code, which resets the counter
    const fresh = refreshPickupCode(pharmacist, o.id);
    expect(dl.pickupAttempts).toBe(0);
    riderStep(rider4, o.id, "PICKUP", fresh.pickupOtp);
    expect(o.status).toBe("PICKED_UP");
    expect(dl.status).toBe("PICKED_UP");
  });
  it("the pickup code expires and an old one stops working after a refresh", () => {
    const o = ready(); acceptDelivery(rider4, o.id);
    const dl = deliveryOf(o)!;
    const oldCode = pickup(o.id);
    dl.pickupOtpExpiresAt = new Date(Date.now() - 1000).toISOString();
    expect(() => riderStep(rider4, o.id, "PICKUP", oldCode)).toThrow(/expired/);
    const fresh = refreshPickupCode(pharmacist, o.id);
    if (fresh.pickupOtp !== oldCode) expect(() => riderStep(rider4, o.id, "PICKUP", oldCode)).toThrow(/Pickup code/);
    riderStep(rider4, o.id, "PICKUP", fresh.pickupOtp);
    expect(o.status).toBe("PICKED_UP");
    expect(() => refreshPickupCode(otherPharmacy, o.id)).toThrow();
  });
  it("only hashes are stored for both codes", () => {
    const o = ready();
    const dl = deliveryOf(o)!;
    const raw = JSON.stringify(dl);
    expect(raw).not.toContain(`"${codeFor(dl, "DELIVERY")}"`);
    expect(Object.keys(dl)).toEqual(expect.arrayContaining(["pickupOtpHash", "deliveryOtpHash"]));
    expect(Object.keys(dl).some((k) => /^(pickupOtp|deliveryOtp|otp)$/i.test(k))).toBe(false);
  });
  it("delivery needs the customer's code; wrong guesses are counted and lock; the pickup code is not accepted", () => {
    const o = pickedUp();
    const dl = deliveryOf(o)!;
    const withCash = { cashCollected: o.total };
    expect(() => riderStep(rider4, o.id, "DELIVER", pickup(o.id), withCash)).toThrow(/Delivery code/);
    for (let i = 0; i < 4; i++) expect(() => riderStep(rider4, o.id, "DELIVER", "0000", withCash)).toThrow(/Delivery code/);
    expect(dl.deliveryAttempts).toBe(5);
    expect(() => riderStep(rider4, o.id, "DELIVER", dcode(o.id), withCash)).toThrow(/Too many wrong/);
    expect(o.status).toBe("OUT_FOR_DELIVERY");
    expect(pay(o.id).status).toBe("PENDING"); // no cash was recorded for a refused attempt
  });
  it("a correct code with cash completes both the delivery and the order; repeating the call is safe", () => {
    const o = pickedUp();
    const code = dcode(o.id);
    riderStep(rider4, o.id, "DELIVER", code, { cashCollected: o.total });
    expect(o.status).toBe("DELIVERED");
    expect(latestDelivery(o)!.status).toBe("DELIVERED");
    expect(() => riderStep(rider4, o.id, "DELIVER", code, { cashCollected: o.total })).not.toThrow(); // idempotent completion
    expect(db().orderStatusHistory.filter((h) => h.orderId === o.id && h.toStatus === "DELIVERED")).toHaveLength(1);
    expect(pay(o.id).status).toBe("PAID");
  });
  it("a prepaid order is completed with the code alone (no cash)", () => {
    const o = online(); capture(o);
    ready(o); pickedUp(o);
    riderStep(rider4, o.id, "DELIVER", dcode(o.id));
    expect(o.status).toBe("DELIVERED");
    expect(pay(o.id)).toMatchObject({ status: "PAID" });
    expect(pay(o.id).codCollectedAt).toBeUndefined();
  });
});

describe("failed delivery and return to pharmacy", () => {
  it("a failed delivery keeps the order open, records the reason, and alerts the customer, pharmacy and support", () => {
    const o = pickedUp();
    expect(() => reportFailedDelivery(rider4, o.id, "OTHER")).toThrow(/describe/);
    reportFailedDelivery(rider4, o.id, "CUSTOMER_UNAVAILABLE", "Door locked");
    const dl = latestDelivery(o)!;
    expect(dl).toMatchObject({ status: "DELIVERY_FAILED", failureReasonCode: "CUSTOMER_UNAVAILABLE", failureReason: "Door locked" });
    expect(dl.failedAt).toBeTruthy();
    expect(o.status).toBe("OUT_FOR_DELIVERY"); // never simply cancelled
    expect(o.stockState).toBe("CONSUMED");
    const events = db().notifications.map((n) => `${n.userId}:${n.event}`);
    expect(events).toContain(`${customer.id}:DELIVERY_FAILED`);
    expect(db().notifications.some((n) => n.event === "SUPPORT_ALERT" && n.title.includes("Delivery failed"))).toBe(true);
    expect(db().audit.find((a) => a.action === "DELIVERY_FAILED")).toMatchObject({ actorId: rider4.id, targetId: dl.id });
    expect(() => reportFailedDelivery(rider4, o.id, "CUSTOMER_UNAVAILABLE")).not.toThrow(); // same report twice
    expect(() => riderStep(rider4, o.id, "DELIVER", dcode(o.id), { cashCollected: o.total })).toThrow(/Start the delivery/);
  });
  it("only the assigned rider can report a failure, and only after pickup", () => {
    const o = ready(); acceptDelivery(rider4, o.id);
    expect(() => reportFailedDelivery(rider4, o.id, "WRONG_ADDRESS")).toThrow(/after pickup/);
    riderStep(rider4, o.id, "PICKUP", pickup(o.id)); riderStep(rider4, o.id, "START");
    expect(() => reportFailedDelivery(rider3, o.id, "WRONG_ADDRESS")).toThrow(/access/);
    expect(() => reportFailedDelivery(rider4, o.id, "NOT_A_REASON" as never)).toThrow(/Choose why/);
  });
  it("support can retry: a new attempt with a fresh code counter, up to three attempts, then return", () => {
    const o = pickedUp();
    reportFailedDelivery(rider4, o.id, "UNABLE_TO_CONTACT");
    const dl = latestDelivery(o)!;
    retryDelivery(admin, dl.id, "Customer called back");
    expect(dl).toMatchObject({ status: "OUT_FOR_DELIVERY", attemptNo: 2, deliveryAttempts: 0 });
    reportFailedDelivery(rider4, o.id, "UNABLE_TO_CONTACT"); retryDelivery(admin, dl.id);
    reportFailedDelivery(rider4, o.id, "UNABLE_TO_CONTACT");
    expect(() => retryDelivery(admin, dl.id)).toThrow(/Return it to the pharmacy/);
    expect(dl.status).toBe("DELIVERY_FAILED");
    expect(dl.attemptNo).toBe(3);
  });
  it("return flow: DELIVERY_FAILED → RETURNING_TO_PHARMACY → RETURNED_TO_PHARMACY, then support cancels and the customer is refunded", () => {
    const o = online(); capture(o); ready(o); pickedUp(o);
    reportFailedDelivery(rider4, o.id, "CUSTOMER_REFUSED");
    const dl = latestDelivery(o)!;
    expect(() => confirmReturnReceived(pharmacist, o.id)).toThrow(/No parcel/);
    expect(() => cancelOrder(admin, o.id, { reasonCode: "DELIVERY_FAILED" })).toThrow(); // not back yet
    returnDelivery(admin, dl.id, "Customer refused");
    expect(dl.status).toBe("RETURNING_TO_PHARMACY");
    expect(dl.returnStartedAt).toBeTruthy();
    expect(db().notifications.some((n) => n.event === "SUPPORT_ALERT" && n.title.includes("coming back"))).toBe(true);
    expect(() => confirmReturnReceived(otherPharmacy, o.id)).toThrow(/access/);
    confirmReturnReceived(pharmacist, o.id);
    expect(dl.status).toBe("RETURNED_TO_PHARMACY");
    expect(dl.returnedAt).toBeTruthy();
    expect(db().notifications.some((n) => n.event === "SUPPORT_ALERT" && n.title.includes("back at the pharmacy"))).toBe(true);
    expect(o.status).toBe("OUT_FOR_DELIVERY");
    // the rider is free again
    expect(availableDeliveries(rider4)).toBeDefined();
    cancelOrder(admin, o.id, { reasonCode: "DELIVERY_FAILED", note: "Returned" });
    expect(o).toMatchObject({ status: "CANCELLED", cancelReasonCode: "DELIVERY_FAILED", paymentStatus: "REFUNDED", stockState: "RELEASED" });
    expect(latestDelivery(o)!.status).toBe("RETURNED_TO_PHARMACY");
  });
  it("support routes work end to end", async () => {
    const o = pickedUp();
    reportFailedDelivery(rider4, o.id, "WRONG_ADDRESS");
    const dl = latestDelivery(o)!;
    await signIn("asha@example.com");
    expect((await call((await route("admin/deliveries/[id]/retry")).POST, "POST", "/x", { params: { id: dl.id }, body: {} })).status).toBe(403);
    await signIn("admin@example.com");
    expect((await call((await route("admin/deliveries/[id]/return")).POST, "POST", "/x", { params: { id: dl.id }, body: { note: "Back it comes" } })).body.data.status).toBe("RETURNING_TO_PHARMACY");
    await signIn("pharmacy@example.com");
    expect((await call((await route("pharmacy/orders/[id]/return-received")).POST, "POST", "/x", { params: { id: o.id } })).body.data.status).toBe("RETURNED_TO_PHARMACY");
    await signIn("admin@example.com");
    const cancelled = await call((await route("admin/orders/[id]/cancel")).POST, "POST", "/x", { params: { id: o.id }, body: { reasonCode: "DELIVERY_FAILED" } });
    expect(cancelled.body.data.status).toBe("CANCELLED");
  });
});

describe("rider location", () => {
  it("only the assigned rider on an active delivery can share it; only the latest point is kept; the customer sees it rounded", () => {
    const o = ready();
    expect(() => updateRiderLocation(rider4, o.id, { lat: 27.5701, lng: 80.6861 })).toThrow(/own active delivery/);
    acceptDelivery(rider4, o.id);
    expect(() => updateRiderLocation(rider3, o.id, { lat: 27.5701, lng: 80.6861 })).toThrow();
    updateRiderLocation(rider4, o.id, { lat: 27.5701, lng: 80.6861 });
    updateRiderLocation(rider4, o.id, { lat: 27.57129, lng: 80.68671 });
    const dl = deliveryOf(o)!;
    expect(dl.lastLocation).toMatchObject({ lat: 27.57129, lng: 80.68671 });
    expect(Object.keys(dl).filter((k) => /location|track|history/i.test(k))).toEqual(["lastLocation"]);
    expect((userSafeOrder(o, customer) as { tracking?: unknown }).tracking).toBeUndefined(); // not picked up yet
    riderStep(rider4, o.id, "PICKUP", pickup(o.id)); riderStep(rider4, o.id, "START");
    updateRiderLocation(rider4, o.id, { lat: 27.57129, lng: 80.68671 });
    const t = (userSafeOrder(o, customer) as { tracking?: { approximate: boolean; lat: number; lng: number } }).tracking!;
    expect(t).toMatchObject({ approximate: true, lat: 27.571, lng: 80.687 });
    expect((userSafeOrder(o, { role: "PHARMACIST" }) as { tracking?: unknown }).tracking).toBeUndefined();
    dl.lastLocation!.at = new Date(Date.now() - 20 * 60_000).toISOString();
    expect((userSafeOrder(o, customer) as { tracking?: unknown }).tracking).toBeUndefined(); // stale position is hidden
    finish(o);
    expect(latestDelivery(o)!.lastLocation).toBeUndefined();
    expect(() => updateRiderLocation(rider4, o.id, { lat: 27.5, lng: 80.6 })).toThrow();
  });
  it("the location route validates coordinates and is rider-only", async () => {
    const o = ready(); acceptDelivery(rider4, o.id);
    const loc = (await route("rider/deliveries/[id]/location")).POST;
    await signIn("asha@example.com");
    expect((await call(loc, "POST", "/x", { params: { id: o.id }, body: { lat: 27.5, lng: 80.6 } })).status).toBe(403);
    await signIn("rider4@example.com");
    expect((await call(loc, "POST", "/x", { params: { id: o.id }, body: { lat: 200, lng: 80.6 } })).status).toBe(400);
    expect((await call(loc, "POST", "/x", { params: { id: o.id }, body: { lat: 27.5, lng: 80.6 } })).status).toBe(200);
  });
});

// ───────────────────────── Settlements ─────────────────────────

describe("settlements", () => {
  it("pharmacy: revenue − discount share − commission − refund adjustment = net; delivery and platform fees are not the pharmacy's", () => {
    settings().commissionPercent = 10;
    settings().platformFee = 4;
    settings().discountPlatformSharePercent = 50;
    const o = otc(4);
    o.discount = 20; // an offer discount of 20, half borne by the pharmacy
    o.total = o.subtotal + o.deliveryFee + o.platformFee - o.discount;
    pay(o.id).amount = o.total;
    ready(o); pickedUp(o); finish(o);
    const calc = pharmacyComponents([o]);
    expect(calc.components).toMatchObject({ medicineRevenue: o.subtotal, discountAllocation: -10, platformCommission: -Math.round(((o.subtotal - 10) * 10) / 100), refundAdjustment: 0 });
    expect(calc.gross).toBe(o.subtotal - 10);
    expect(calc.commission).toBe(Math.round(((o.subtotal - 10) * 10) / 100));
    expect(calc.net).toBe(calc.gross - calc.commission);
  });
  it("a refund after delivery reduces the pharmacy's net, but a refund for dropped items does not", () => {
    const o = online(2); capture(o); ready(o); pickedUp(o);
    riderStep(rider4, o.id, "DELIVER", dcode(o.id));
    const before = pharmacyComponents([o]).net;
    adminRefund(admin, pay(o.id).id, { amount: 10, reason: "Damaged strip", key: "settle-refund-1" });
    const after = pharmacyComponents([o]);
    expect(after.components.refundAdjustment).toBe(-10);
    expect(after.net).toBe(before - 10);
  });
  it("rider: base + distance + incentive; a settlement starts PENDING, becomes ELIGIBLE after the hold, then PROCESSING → PAID; ON_HOLD and FAILED are handled", () => {
    settings().riderPerKm = 10;
    const o = ready(); pickedUp(o); finish(o);
    const dl = latestDelivery(o)!;
    const calc = riderComponents([dl]);
    expect(calc.net).toBe(dl.earning!.base + dl.earning!.distance + dl.earning!.incentive);
    const made = generateSettlements(admin);
    const riderSet = made.find((s) => s.partnerType === "DELIVERY" && s.partnerId === "dp_4")!;
    const pharmSet = made.find((s) => s.partnerType === "PHARMACY" && s.partnerId === "ph_1")!;
    expect(riderSet).toMatchObject({ status: "PENDING", net: calc.net, deliveryIds: [dl.id] });
    expect(dl.settlementId).toBe(riderSet.id);
    expect(pharmSet.orderIds).toContain(o.id);
    expect(generateSettlements(admin).filter((s) => s.partnerId === "dp_4")).toHaveLength(0); // never settled twice
    expect(() => setSettlementStatus(admin, riderSet.id, "PROCESSING")).toThrow(/hold period/);
    expect(promoteEligibleSettlements(Date.now() + 25 * 3600_000)).toBeGreaterThanOrEqual(2);
    expect(riderSet.status).toBe("ELIGIBLE");
    expect(() => setSettlementStatus(admin, riderSet.id, "ON_HOLD")).toThrow(/why/);
    riderSet.eligibleAt = new Date(Date.now() - 1000).toISOString(); // the hold period is over (the clock above was only advanced for the promotion)
    setSettlementStatus(admin, riderSet.id, "ON_HOLD", "Cash mismatch under review");
    expect(riderSet).toMatchObject({ status: "ON_HOLD", holdReason: "Cash mismatch under review" });
    setSettlementStatus(admin, riderSet.id, "ELIGIBLE");
    setSettlementStatus(admin, riderSet.id, "PROCESSING");
    setSettlementStatus(admin, riderSet.id, "FAILED");
    setSettlementStatus(admin, riderSet.id, "PROCESSING");
    setSettlementStatus(admin, riderSet.id, "PAID");
    expect(riderSet.paidAt).toBeTruthy();
    expect(() => setSettlementStatus(admin, riderSet.id, "PENDING")).toThrow(/paid/);
    expect(db().audit.filter((a) => a.action === "SETTLEMENT_STATUS" && a.targetId === riderSet.id).length).toBeGreaterThanOrEqual(5);
  });
  it("manual adjustments need a reason, change the net, are audited with before/after, and are blocked once paid", () => {
    const o = ready(); pickedUp(o); finish(o);
    const s = generateSettlements(admin).find((x) => x.partnerType === "DELIVERY" && x.partnerId === "dp_4")!;
    const net = s.net;
    expect(() => adjustSettlement(admin, s.id, 25, "")).toThrow(/reason/);
    expect(() => adjustSettlement(admin, s.id, 0, "nothing")).toThrow(/not zero/);
    adjustSettlement(admin, s.id, 25, "Rain bonus");
    adjustSettlement(admin, s.id, -5, "Late pickup");
    expect(s.net).toBe(net + 20);
    expect(s.components!.adjustment).toBe(20);
    const log = db().audit.find((a) => a.action === "SETTLEMENT_ADJUSTED")!;
    expect(log.before).toMatchObject({ net: net + 25 });
    expect(log.after).toMatchObject({ net: net + 20 });
    promoteEligibleSettlements(Date.now() + 25 * 3600_000);
    setSettlementStatus(admin, s.id, "PROCESSING"); setSettlementStatus(admin, s.id, "PAID");
    expect(() => adjustSettlement(admin, s.id, 5, "Too late")).toThrow(/paid/);
  });
});

// ───────────────────────── Audit ─────────────────────────

describe("audit trail", () => {
  it("records actor, role, action, entity, before and after, and time for the sensitive actions", () => {
    const o = online(); capture(o);
    cancelOrder(customer, o.id, { reasonCode: "CHANGED_MIND" });
    const p = pay(o.id);
    const q = online(); retryPayment(customer, q.id, { method: "COD" });
    const need = ["ORDER_CANCELLED", "REFUND_REQUESTED", "PAYMENT_SWITCHED_TO_COD"];
    for (const action of need) {
      const a = db().audit.find((x) => x.action === action)!;
      expect(a, action).toBeTruthy();
      expect(a).toMatchObject({ actorId: expect.any(String), actorRole: expect.any(String), targetType: expect.any(String), targetId: expect.any(String), at: expect.any(String) });
    }
    expect(db().audit.find((a) => a.action === "REFUND_REQUESTED")).toMatchObject({ targetType: "Refund", before: { refunded: 0 }, after: { refundRequested: o.total } });
    expect(p.status).toBe("REFUNDED");
  });
});
