import { randomUUID } from "node:crypto";
import type { Order, Payment, PaymentAttempt, PaymentMethod, Refund, RefundStatus, Role, SessionUser } from "@/lib/types";
import { ApiError, badRequest, conflict, forbidden, notFound } from "@/server/errors";
import { fingerprint, record, seen } from "@/server/idempotency";
import { notify, notifyAdmins } from "@/server/features/notifications/notify";
import { audit, db, settings, uid } from "@/server/store";
import { atomically } from "@/server/tx";
import { pharmacyWindowFor } from "@/server/features/orders/policy";
import { mockGateway, mockGatewayEnabled, providerForMethod, providerNamed, signMockWebhook, toPaise, type NormalizedWebhook } from "./providers";

/**
 * Payments, independent of any gateway.
 *
 *  - An order has exactly ONE Payment. Every try to pay is a PaymentAttempt, so retrying never makes a second order or payment.
 *  - The ONLY thing that marks an online payment PAID is a verified webhook from the gateway (processWebhook). The browser's
 *    "payment successful" screen is cosmetic: it can be faked, closed early or never reached.
 *  - Cash on delivery stays PENDING until the rider records the cash at the door (recordCodCollection).
 *  - Refunds are their own rows, idempotent by key, and the order shows their status.
 *
 * Gateway specifics live behind PaymentProvider (providers.ts). Nothing in here knows what a gateway calls its ids.
 */

const now = () => new Date().toISOString();
const SYSTEM = { id: "system", role: "SYSTEM" as const };
type Actor = SessionUser | typeof SYSTEM;
const roleOf = (a: Actor): Role | "SYSTEM" => a.role;

export const paymentOf = (orderId: string): Payment | undefined => db().payments.find((p) => p.orderId === orderId);
export const attemptsOf = (paymentId: string): PaymentAttempt[] => db().paymentAttempts.filter((a) => a.paymentId === paymentId).sort((a, b) => a.attemptNumber - b.attemptNumber);
const orderOf = (id: string) => db().orders.find((o) => o.id === id);

/** The order mirrors the payment's status; only this function writes `order.paymentStatus`. */
function syncOrder(pay: Payment) {
  const o = orderOf(pay.orderId);
  if (!o) return;
  o.paymentStatus = pay.status;
  o.refundStatus = deriveRefundStatus(o.id);
}

/** NOT_REQUIRED when nothing was refunded or owed; otherwise the least finished refund wins (failed > processing > pending). */
export function deriveRefundStatus(orderId: string): RefundStatus {
  const rs = db().refunds.filter((r) => r.orderId === orderId);
  if (!rs.length) return "NOT_REQUIRED";
  if (rs.some((r) => r.status === "FAILED")) return "FAILED";
  if (rs.some((r) => r.status === "PROCESSING")) return "PROCESSING";
  if (rs.some((r) => r.status === "PENDING")) return "PENDING";
  const pay = paymentOf(orderId);
  const done = rs.reduce((s, r) => s + r.amount, 0);
  return pay && done < pay.amount ? "PARTIAL" : "COMPLETED";
}

// ───────────────────────── Creating payments and attempts ─────────────────────────

/** A new attempt with the gateway for the amount currently owed. Reuses the open attempt if there already is one. */
function startAttempt(pay: Payment, o: Order): { attempt: PaymentAttempt; checkout?: Record<string, string> } {
  const open = attemptsOf(pay.id).find((a) => a.status === "PENDING");
  if (open) return { attempt: open };
  const provider = providerNamed(pay.provider);
  const attemptNumber = attemptsOf(pay.id).length + 1;
  const g = provider.createPayment({ paymentId: pay.id, orderId: o.id, amountPaise: toPaise(pay.amount), currency: "INR", attemptNumber, method: pay.method });
  const attempt: PaymentAttempt = { id: uid("pa"), paymentId: pay.id, orderId: o.id, attemptNumber, provider: provider.name, providerOrderId: g.providerOrderId, amount: pay.amount, status: "PENDING", createdAt: now() };
  db().paymentAttempts.push(attempt);
  pay.providerOrderId = g.providerOrderId;
  pay.status = "PENDING";
  pay.updatedAt = now();
  syncOrder(pay);
  return { attempt, checkout: g.checkout };
}

/** Called once by checkout. COD: a PENDING record, no gateway. Online: the record plus the first attempt. */
export function openPayment(o: Order, userId: string): Payment {
  const method = o.paymentMethod;
  const provider = providerForMethod(method);
  const pay: Payment = { id: uid("pay"), orderId: o.id, userId, method, provider: provider.name, amount: o.total, currency: "INR", refundedAmount: 0, status: "PENDING", createdAt: now(), updatedAt: now() };
  db().payments.push(pay);
  if (provider.online) startAttempt(pay, o);
  return pay;
}

function ownOrder(user: SessionUser, orderId: string): { o: Order; pay: Payment } {
  const o = db().orders.find((x) => x.id === orderId || x.code === orderId);
  if (!o || o.userId !== user.id) throw notFound("Order not found");
  const pay = paymentOf(o.id);
  if (!pay) throw notFound("Payment not found");
  return { o, pay };
}

export interface PaymentView {
  id: string; orderId: string; method: PaymentMethod; provider: string; amount: number; currency: "INR"; status: Payment["status"]; refundedAmount: number;
  paidAt?: string; codCollectedAt?: string; attempts: number; refundStatus: RefundStatus;
  /** Only while an attempt is open: what the app needs to open the gateway's checkout */
  checkout?: { providerOrderId: string; amountPaise: number; currency: "INR"; extra?: Record<string, string> };
  refunds: { id: string; amount: number; status: Refund["status"]; reason: string; createdAt: string; completedAt?: string }[];
}

export function paymentView(pay: Payment, checkout?: Record<string, string>): PaymentView {
  const open = attemptsOf(pay.id).find((a) => a.status === "PENDING");
  return {
    id: pay.id, orderId: pay.orderId, method: pay.method, provider: pay.provider, amount: pay.amount, currency: pay.currency, status: pay.status, refundedAmount: pay.refundedAmount,
    paidAt: pay.paidAt, codCollectedAt: pay.codCollectedAt, attempts: attemptsOf(pay.id).length, refundStatus: deriveRefundStatus(pay.orderId),
    checkout: open?.providerOrderId ? { providerOrderId: open.providerOrderId, amountPaise: toPaise(open.amount), currency: "INR", extra: checkout } : undefined,
    refunds: db().refunds.filter((r) => r.paymentId === pay.id).map((r) => ({ id: r.id, amount: r.amount, status: r.status, reason: r.reason, createdAt: r.createdAt, completedAt: r.completedAt })),
  };
}

/**
 * Open (or re-open) an online payment for an order. Safe to call twice: while an attempt is open it is returned as is, so a
 * double tap never makes two charges. After a failed attempt it opens attempt #2, inside the same payment window.
 */
export function createPaymentForOrder(user: SessionUser, orderId: string): PaymentView {
  return atomically(["payments", "paymentAttempts", "orders"], () => {
    const { o, pay } = ownOrder(user, orderId);
    if (o.paymentMethod === "COD") throw badRequest("This order is Cash on Delivery. There is nothing to pay online.");
    if (o.status === "CANCELLED" || o.status === "DELIVERED") throw conflict("This order is closed");
    if (pay.status === "PAID" || pay.status === "AUTHORIZED") return paymentView(pay);
    if (pay.status === "REFUNDED" || pay.status === "PARTIALLY_REFUNDED") throw conflict("This order was already paid and refunded");
    if (o.paymentExpiresAt && Date.parse(o.paymentExpiresAt) < Date.now()) throw conflict("The payment time is over. Please place the order again.");
    const { checkout } = startAttempt(pay, o);
    return paymentView(pay, checkout);
  });
}

/** Cash on delivery is allowed for smaller orders, and only while nothing has been paid online. */
export function codEligible(o: Pick<Order, "total" | "status">, pay?: Pick<Payment, "status">): { ok: boolean; reason?: string } {
  const max = settings().codMaxAmount ?? 5000;
  if (o.total > max) return { ok: false, reason: `Cash on delivery is available for orders up to ₹${max}.` };
  if (pay && (pay.status === "PAID" || pay.status === "AUTHORIZED" || pay.status === "REFUNDED" || pay.status === "PARTIALLY_REFUNDED")) return { ok: false, reason: "This order is already paid." };
  if (o.status === "CANCELLED" || o.status === "DELIVERED") return { ok: false, reason: "This order is closed." };
  return { ok: true };
}

/**
 * The customer's way out of a failed online payment: pay online again (same order), or pay cash on delivery.
 * Never creates a second order. Cancelling instead is the normal cancel endpoint.
 */
export function retryPayment(user: SessionUser, orderId: string, input: { method?: PaymentMethod } = {}): PaymentView {
  return atomically(["payments", "paymentAttempts", "orders"], () => {
    const { o, pay } = ownOrder(user, orderId);
    if (input.method === "COD" && o.paymentMethod !== "COD") return switchToCod(user, o, pay);
    if (o.paymentMethod === "COD") throw badRequest("This order is Cash on Delivery");
    if (input.method && input.method !== o.paymentMethod) {
      // Another online method (UPI → card): same payment, same order, a fresh attempt
      if (pay.status === "PAID" || pay.status === "AUTHORIZED") throw conflict("This order is already paid");
      for (const a of attemptsOf(pay.id)) if (a.status === "PENDING") { a.status = "EXPIRED"; }
      o.paymentMethod = input.method;
      pay.method = input.method;
    }
    return createPaymentForOrder(user, o.id);
  });
}

function switchToCod(user: SessionUser, o: Order, pay: Payment): PaymentView {
  const ok = codEligible(o, pay);
  if (!ok.ok) throw conflict(ok.reason ?? "Cash on delivery is not available for this order");
  for (const a of attemptsOf(pay.id)) if (a.status === "PENDING") a.status = "EXPIRED";
  const before = { method: pay.method, status: pay.status };
  o.paymentMethod = "COD";
  o.paymentExpiresAt = undefined;
  o.reservationExpiresAt = new Date(Date.now() + pharmacyWindowFor(o)).toISOString();
  pay.method = "COD";
  pay.provider = "COD";
  pay.providerOrderId = undefined;
  pay.status = "PENDING";
  pay.updatedAt = now();
  syncOrder(pay);
  audit(user, "PAYMENT_SWITCHED_TO_COD", "Payment", pay.id, { orderId: o.id }, { before, after: { method: "COD", status: "PENDING" } });
  return paymentView(pay);
}

// ───────────────────────── Webhook ─────────────────────────

export type WebhookResult = { handled: boolean; duplicate?: boolean; ignored?: string; rejected?: string };

/**
 * Entry point for the gateway's server-to-server notifications.
 *  1 the signature over the RAW body must be valid (401 otherwise: nothing is read or changed)
 *  2 the event id must be new (a repeat is acknowledged and ignored)
 *  3 the attempt must exist, belong to the payment/order it names, and the amount must equal what we asked for
 * Only then does state change. A failure part-way rolls everything back and records nothing, so the gateway's retry is safe.
 */
export function processWebhook(rawBody: string, signature: string | null, providerName?: string): WebhookResult {
  const provider = providerName ? providerNamed(providerName) : providerForMethod("UPI");
  if (!provider.verifyPayment(rawBody, signature)) {
    audit(SYSTEM, "WEBHOOK_REJECTED", "Webhook", "-", { reason: "bad signature" });
    throw new ApiError(401, "Invalid signature", undefined, "INVALID_SIGNATURE");
  }
  let ev: NormalizedWebhook;
  try { ev = provider.parseWebhook(rawBody); } catch (e) { throw e instanceof ApiError ? e : badRequest("Unreadable webhook"); }
  const scope = `webhook:${provider.name}`;
  if (seen(scope, ev.eventId)) return { handled: false, duplicate: true };

  const result = atomically(["payments", "paymentAttempts", "orders", "refunds", "notifications", "audit", "idempotencyRecords"], () => {
    const r = applyWebhook(ev);
    record(scope, ev.eventId, r);
    return r;
  });
  return result;
}

function applyWebhook(ev: NormalizedWebhook): WebhookResult {
  const d = db();
  if (ev.type === "REFUND_PROCESSED" || ev.type === "REFUND_FAILED") {
    const rf = d.refunds.find((r) => r.providerRefundId === ev.providerRefundId);
    if (!rf) return { handled: false, ignored: "UNKNOWN_REFUND" };
    if (rf.status === "COMPLETED") return { handled: false, duplicate: true };
    if (ev.type === "REFUND_PROCESSED") completeRefund(rf); else failRefund(rf, ev.failureMessage ?? "The gateway could not process the refund");
    return { handled: true };
  }
  const attempt = d.paymentAttempts.find((a) => a.providerOrderId === ev.providerOrderId);
  if (!attempt) return { handled: false, ignored: "UNKNOWN_PAYMENT" };
  const pay = d.payments.find((p) => p.id === attempt.paymentId);
  const o = pay && orderOf(pay.orderId);
  if (!pay || !o || attempt.orderId !== o.id) {
    audit(SYSTEM, "WEBHOOK_MISMATCH", "PaymentAttempt", attempt.id, { providerOrderId: ev.providerOrderId });
    return { handled: false, rejected: "ORDER_MISMATCH" };
  }

  if (ev.type === "PAYMENT_FAILED") {
    // A failure that arrives after success is out of order: ignore it
    if (attempt.status === "SUCCEEDED" || pay.status === "PAID") return { handled: false, ignored: "ALREADY_PAID" };
    attempt.status = "FAILED";
    attempt.failureCode = ev.failureCode ?? "PAYMENT_FAILED";
    attempt.failureMessage = ev.failureMessage ?? "The payment did not go through";
    pay.status = "FAILED";
    pay.updatedAt = now();
    syncOrder(pay);
    if (o.status !== "CANCELLED") notify(o.userId, "PAYMENT_FAILED", "Payment failed", `The payment for order ${o.code} did not go through. You can try again, pay cash on delivery, or cancel the order.`);
    return { handled: true };
  }

  // PAYMENT_CAPTURED
  if (ev.amountPaise !== toPaise(attempt.amount)) {
    attempt.status = "FAILED";
    attempt.failureCode = "AMOUNT_MISMATCH";
    attempt.failureMessage = `Expected ${toPaise(attempt.amount)} paise, gateway reported ${ev.amountPaise ?? "none"}`;
    audit(SYSTEM, "PAYMENT_AMOUNT_MISMATCH", "Payment", pay.id, { expected: toPaise(attempt.amount), got: ev.amountPaise ?? null, orderId: o.id });
    alertSupport(`Payment amount mismatch on order ${o.code}`, `Gateway reported a different amount for order ${o.code}. The order was not marked paid.`);
    return { handled: false, rejected: "AMOUNT_MISMATCH" };
  }
  if (attempt.status === "SUCCEEDED") return { handled: false, duplicate: true };
  attempt.status = "SUCCEEDED";
  attempt.providerPaymentId = ev.providerPaymentId;

  if (pay.status === "PAID" || pay.status === "AUTHORIZED" || pay.status === "PARTIALLY_REFUNDED" || pay.status === "REFUNDED") {
    // A second capture for an order that is already paid: money we must not keep
    orphanRefund(pay, attempt, "Duplicate payment for the same order");
    return { handled: true, ignored: "DUPLICATE_CAPTURE_REFUNDED" };
  }
  if (o.paymentMethod === "COD") {
    orphanRefund(pay, attempt, "Order was switched to cash on delivery");
    return { handled: true, ignored: "CAPTURE_AFTER_COD_REFUNDED" };
  }

  pay.status = "PAID";
  pay.providerPaymentId = ev.providerPaymentId;
  pay.providerOrderId = attempt.providerOrderId;
  pay.paidAt = now();
  pay.updatedAt = pay.paidAt;
  syncOrder(pay);
  if (o.status === "CANCELLED") {
    // The customer cancelled while the payment was in flight: give it straight back
    requestRefund({ payment: pay, actor: SYSTEM, reason: "Order was cancelled before the payment arrived", key: `late:${attempt.id}` });
    return { handled: true, ignored: "LATE_CAPTURE_REFUNDED" };
  }
  o.paymentExpiresAt = undefined;
  // Paid: the next deadline is the pharmacy's, not the customer's
  if (o.stockState === "RESERVED") o.reservationExpiresAt = new Date(Date.now() + pharmacyWindowFor(o)).toISOString();
  notify(o.userId, "PAYMENT_RECEIVED", "Payment received", `We received your payment for order ${o.code}. Thank you.`);
  return { handled: true };
}

const alertSupport = notifyAdmins;

// ───────────────────────── Cash on delivery ─────────────────────────

/** The rider handed over the parcel and took the cash. The only moment a COD payment becomes PAID. */
export function recordCodCollection(orderId: string, amount: number): Payment {
  const o = orderOf(orderId);
  const pay = paymentOf(orderId);
  if (!o || !pay || pay.method !== "COD") throw conflict("This order is not Cash on Delivery");
  if (pay.status === "PAID") return pay;
  if (amount !== pay.amount) throw badRequest(`Collect exactly ₹${pay.amount} in cash`);
  pay.status = "PAID";
  pay.codCollectedAt = now();
  pay.codCollectedAmount = amount;
  pay.paidAt = pay.codCollectedAt;
  pay.updatedAt = pay.paidAt;
  syncOrder(pay);
  return pay;
}

// ───────────────────────── Refunds ─────────────────────────

const refundable = (pay: Payment) => pay.amount - pay.refundedAmount - db().refunds.filter((r) => r.paymentId === pay.id && (r.status === "PENDING" || r.status === "PROCESSING")).reduce((s, r) => s + r.amount, 0);

/**
 * Money back to the customer. Same (payment, key) = same refund: asking again returns the first one (or retries it if it
 * FAILED). Together the open and finished refunds can never exceed what was paid.
 */
export function requestRefund(i: { payment: Payment; amount?: number; actor: Actor; reason: string; key: string }): Refund {
  const { payment: pay, actor } = i;
  const amount = i.amount ?? refundable(pay);
  const existing = db().refunds.find((r) => r.paymentId === pay.id && r.idempotencyKey === i.key);
  if (existing) {
    if (i.amount !== undefined && existing.amount !== i.amount) throw new ApiError(422, "This Idempotency-Key was already used for a different refund.", undefined, "IDEMPOTENCY_KEY_REUSED");
    if (existing.status === "FAILED") { existing.status = "PENDING"; existing.failureMessage = undefined; processRefund(existing, pay); }
    return existing;
  }
  if (pay.method === "COD" && !pay.codCollectedAt) throw conflict("Nothing was paid online, so there is nothing to refund");
  if (pay.status !== "PAID" && pay.status !== "PARTIALLY_REFUNDED" && pay.status !== "AUTHORIZED") throw conflict("This payment has no money to refund");
  if (!(amount > 0)) throw badRequest("There is nothing left to refund");
  if (amount > refundable(pay) + 0.001) throw badRequest(`Only ₹${refundable(pay)} can still be refunded`);
  const rf: Refund = {
    id: uid("rf"), paymentId: pay.id, orderId: pay.orderId, amount, status: "PENDING", reason: i.reason, kind: amount >= pay.amount ? "FULL" : "PARTIAL",
    requestedBy: actor.id, actorRole: roleOf(actor), idempotencyKey: i.key, createdAt: now(), updatedAt: now(),
  };
  db().refunds.push(rf);
  audit(actor, "REFUND_REQUESTED", "Refund", rf.id, { orderId: pay.orderId, amount, reason: i.reason, key: i.key, by: roleOf(actor) }, { before: { refunded: pay.refundedAmount }, after: { refundRequested: amount } });
  const o = orderOf(pay.orderId);
  if (o) { o.refundStatus = deriveRefundStatus(o.id); notify(o.userId, "REFUND_INITIATED", "Refund started", `We started a refund of ₹${amount} for order ${o.code}. It usually reaches your account in 5 to 7 working days.`); }
  processRefund(rf, pay);
  return rf;
}

function processRefund(rf: Refund, pay: Payment) {
  if (!pay.providerPaymentId) { failRefund(rf, "The payment has no gateway reference"); return; }
  try {
    const r = providerNamed(pay.provider).refundPayment({ providerPaymentId: pay.providerPaymentId, amountPaise: toPaise(rf.amount), idempotencyKey: `${pay.id}:${rf.idempotencyKey}`, reason: rf.reason });
    rf.providerRefundId = r.providerRefundId;
    rf.updatedAt = now();
    if (r.status === "COMPLETED") completeRefund(rf);
    else if (r.status === "PROCESSING") { rf.status = "PROCESSING"; const o = orderOf(rf.orderId); if (o) o.refundStatus = deriveRefundStatus(o.id); }
    else failRefund(rf, r.failureMessage ?? "The gateway could not process the refund");
  } catch (e) {
    failRefund(rf, e instanceof Error ? e.message : "The refund could not be sent");
  }
}

function completeRefund(rf: Refund) {
  if (rf.status === "COMPLETED") return;
  const pay = db().payments.find((p) => p.id === rf.paymentId)!;
  rf.status = "COMPLETED";
  rf.completedAt = now();
  rf.updatedAt = rf.completedAt;
  pay.refundedAmount = Math.round((pay.refundedAmount + rf.amount) * 100) / 100;
  pay.status = pay.refundedAmount >= pay.amount ? "REFUNDED" : "PARTIALLY_REFUNDED";
  pay.updatedAt = rf.completedAt;
  syncOrder(pay);
  const o = orderOf(rf.orderId);
  if (o) notify(o.userId, "REFUND_COMPLETED", "Refund complete", `₹${rf.amount} was refunded for order ${o.code}.`);
}

function failRefund(rf: Refund, message: string) {
  rf.status = "FAILED";
  rf.failureMessage = message;
  rf.updatedAt = now();
  const pay = db().payments.find((p) => p.id === rf.paymentId);
  if (pay) syncOrder(pay);
  audit(SYSTEM, "REFUND_FAILED", "Refund", rf.id, { orderId: rf.orderId, message });
  alertSupport("A refund failed", `Refund ${rf.id} for ₹${rf.amount} failed: ${message}. Please retry it from the payments screen.`);
  const o = orderOf(rf.orderId);
  if (o) notify(o.userId, "REFUND_FAILED", "Refund delayed", `We could not send your refund for order ${o.code} yet. Our team will sort it out and you do not need to do anything.`);
}

/** Money taken by the gateway for an attempt we no longer want (order switched to COD, or a double payment). Straight back. */
function orphanRefund(pay: Payment, attempt: PaymentAttempt, reason: string) {
  const rf: Refund = {
    id: uid("rf"), paymentId: pay.id, orderId: pay.orderId, amount: attempt.amount, status: "PENDING", reason, kind: "FULL", requestedBy: "system", actorRole: "SYSTEM",
    idempotencyKey: `orphan:${attempt.id}`, createdAt: now(), updatedAt: now(),
  };
  db().refunds.push(rf);
  try {
    const r = providerNamed(attempt.provider).refundPayment({ providerPaymentId: attempt.providerPaymentId ?? "", amountPaise: toPaise(attempt.amount), idempotencyKey: rf.idempotencyKey, reason });
    rf.providerRefundId = r.providerRefundId;
    rf.status = r.status === "COMPLETED" ? "COMPLETED" : r.status === "PROCESSING" ? "PROCESSING" : "FAILED";
    if (rf.status === "COMPLETED") rf.completedAt = now();
    if (rf.status === "FAILED") rf.failureMessage = r.failureMessage;
  } catch (e) {
    rf.status = "FAILED";
    rf.failureMessage = e instanceof Error ? e.message : "Refund failed";
  }
  audit(SYSTEM, "REFUND_REQUESTED", "Refund", rf.id, { orderId: pay.orderId, amount: rf.amount, reason, orphan: true });
  if (rf.status === "FAILED") alertSupport("A refund failed", `Refund ${rf.id} (${reason}) failed. Please retry it.`);
}

/**
 * When an order is cancelled: unpaid payments are closed, and paid ones are refunded in full. COD with no cash taken needs nothing.
 * The refund key is derived from the order, so cancelling twice (or a retry after a crash) refunds once.
 */
export function settlePaymentOnCancel(o: Order, actor: Actor, reason: string) {
  const pay = paymentOf(o.id);
  if (!pay) return;
  if (pay.status === "PENDING" || pay.status === "FAILED") {
    for (const a of attemptsOf(pay.id)) if (a.status === "PENDING" || a.status === "CREATED") a.status = "EXPIRED";
    pay.status = "FAILED";
    pay.updatedAt = now();
    syncOrder(pay);
    return;
  }
  if (pay.status === "PAID" || pay.status === "AUTHORIZED" || pay.status === "PARTIALLY_REFUNDED") {
    if (refundable(pay) > 0) requestRefund({ payment: pay, actor, reason, key: `cancel:${o.id}` });
  }
}

/** Expire attempts whose order ran out of time (called by the reservation sweeper's cancellation) — kept for tests and reports. */
export const openAttempts = (paymentId: string) => attemptsOf(paymentId).filter((a) => a.status === "PENDING");

// ───────────────────────── Reading ─────────────────────────

/** Customer: own payment. Pharmacy staff: payments of their pharmacy's orders (read only). Admin: any. */
export function getPaymentFor(user: SessionUser, paymentId: string): PaymentView {
  const pay = db().payments.find((p) => p.id === paymentId);
  const o = pay && orderOf(pay.orderId);
  if (!pay || !o) throw notFound("Payment not found");
  const staff = (user.role === "PHARMACY_ADMIN" || user.role === "PHARMACIST") && user.partnerId === o.pharmacyId;
  if (!(pay.userId === user.id || staff || user.role === "SUPER_ADMIN")) throw forbidden();
  const v = paymentView(pay);
  // Staff see the state of the money, never the gateway's handles
  return pay.userId === user.id ? v : { ...v, checkout: undefined };
}

/** Support/admin refund (full remainder by default). `key` makes repeats safe. */
export function adminRefund(actor: SessionUser, paymentId: string, input: { amount?: number; reason: string; key: string }): Refund {
  return atomically(["payments", "refunds", "orders", "notifications", "audit"], () => {
    const pay = db().payments.find((p) => p.id === paymentId);
    if (!pay) throw notFound("Payment not found");
    return requestRefund({ payment: pay, amount: input.amount, actor, reason: input.reason, key: input.key });
  });
}

// ───────────────────────── Development helper ─────────────────────────

/**
 * Stand-in for the customer finishing (or abandoning) the gateway's checkout page. It does what a real gateway does: it POSTs a
 * SIGNED webhook, so the very same verified path runs. Only when the mock gateway is active and never in production.
 */
export function mockComplete(user: SessionUser, paymentId: string, outcome: "success" | "failure"): WebhookResult {
  if (!mockGatewayEnabled()) throw forbidden("The test payment screen is switched off");
  const pay = db().payments.find((p) => p.id === paymentId);
  if (!pay || pay.userId !== user.id) throw notFound("Payment not found");
  const attempt = attemptsOf(pay.id).find((a) => a.status === "PENDING");
  if (!attempt?.providerOrderId) throw conflict("There is no payment waiting to be completed");
  const body: Record<string, unknown> = outcome === "success"
    ? { eventId: `evt_${randomUUID()}`, type: "PAYMENT_CAPTURED", providerOrderId: attempt.providerOrderId, providerPaymentId: `mock_pay_${randomUUID().slice(0, 8)}`, amountPaise: toPaise(attempt.amount) }
    : { eventId: `evt_${randomUUID()}`, type: "PAYMENT_FAILED", providerOrderId: attempt.providerOrderId, failureCode: "USER_CANCELLED", failureMessage: "Payment was not completed" };
  const raw = JSON.stringify(body);
  return processWebhook(raw, signMockWebhook(raw), "MOCK");
}

export { fingerprint, mockGateway };
