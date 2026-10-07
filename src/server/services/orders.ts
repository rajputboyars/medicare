import { applyOffer, deliveryFee } from "@/lib/pricing";
import { estimateEta } from "@/lib/eta";
import { distanceKm } from "@/lib/geo";
import { STATUS_LABEL, canTransition, isFinal } from "@/lib/order-machine";
import type { DeliveryPartner, Order, OrderItem, OrderStatus, PaymentMethod, SessionUser } from "@/lib/types";
import { badRequest, conflict, forbidden, notFound } from "../errors";
import { release, reserve, stockFor } from "../inventory";
import { notify } from "../notifications";
import { providerFor } from "../payments";
import { audit, db, orderCode, otp, settings, uid } from "../store";

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
const MAX_ACTIVE_JOBS = 3;

type Actor = SessionUser | "SYSTEM";
const roleOf = (a: Actor) => (a === "SYSTEM" ? "SYSTEM" : a.role);

/**
 * The ONLY way an order's status changes. Validates against the state machine, runs side effects
 * (stock reservation, refunds, rider release), then records the event.
 */
export function transition(o: Order, to: OrderStatus, actor: Actor, note?: string): Order {
  const from = o.status;
  if (!canTransition(from, to, roleOf(actor))) {
    throw conflict(`This order cannot go from “${STATUS_LABEL[from]}” to “${STATUS_LABEL[to]}” right now.`);
  }
  const d = db();
  if (to === "CONFIRMED") {
    if (o.items.some((i) => i.prescriptionRequired)) {
      const rx = d.prescriptions.find((p) => p.id === o.prescriptionId);
      if (rx?.status !== "APPROVED") throw conflict("The prescription is not approved for this order");
    }
    reserve(o.pharmacyId, o.items);
    o.stockReserved = true;
  }
  if (to === "CANCELLED") {
    if (o.stockReserved) { release(o.pharmacyId, o.items); o.stockReserved = false; }
    if (o.paymentStatus === "PAID") {
      o.paymentStatus = providerFor(o.paymentMethod).refund(o).status;
      const pay = d.payments.find((p) => p.orderId === o.id);
      if (pay) pay.status = o.paymentStatus;
    } else if (o.paymentStatus === "PENDING" || o.paymentStatus === "COD_DUE") {
      o.paymentStatus = "FAILED";
      const pay = d.payments.find((p) => p.orderId === o.id);
      if (pay) pay.status = "FAILED";
    }
    const dl = d.deliveries.find((x) => x.orderId === o.id && x.status !== "CANCELLED" && x.status !== "DELIVERED");
    if (dl) dl.status = "CANCELLED";
    o.deliveryPartnerId = undefined;
    o.cancelReason = note;
    o.cancelledBy = actor === "SYSTEM" ? undefined : actor.role;
  }
  if (from === "RIDER_ASSIGNED" && to === "READY_FOR_PICKUP") {
    const dl = d.deliveries.find((x) => x.orderId === o.id && x.status === "ASSIGNED");
    if (dl) dl.status = "CANCELLED";
    o.deliveryPartnerId = undefined;
  }
  o.status = to;
  o.statusHistory.push({ status: to, at: new Date().toISOString(), note, by: actor === "SYSTEM" ? undefined : actor.role });
  return o;
}

export function createOrder(user: SessionUser, input: CreateOrderInput): Order {
  const d = db();
  const pharmacy = d.pharmacies.find((p) => p.id === input.pharmacyId);
  if (!pharmacy || pharmacy.verification !== "VERIFIED") throw badRequest("This pharmacy is not available");
  if (!pharmacy.acceptingOrders) throw badRequest("This pharmacy is not taking orders right now");
  const address = d.addresses.find((a) => a.id === input.addressId && a.userId === user.id);
  if (!address) throw badRequest("Please choose a delivery address");
  if (!pharmacy.servicePincodes.includes(address.pincode)) throw badRequest("This pharmacy does not deliver to your pincode");
  if (input.deliveryType === "PRIORITY" && !pharmacy.priorityDelivery) throw badRequest("Priority delivery is not available from this pharmacy");
  if (input.familyMemberId && !d.familyMembers.some((f) => f.id === input.familyMemberId && f.userId === user.id)) throw badRequest("Unknown family member");

  const orderId = uid("ord");
  const merged = new Map<string, number>();
  for (const it of input.items) merged.set(it.medicineId, (merged.get(it.medicineId) ?? 0) + it.quantity);

  const items: OrderItem[] = [];
  let needsRx = false;
  let hasRestricted = false;
  let n = 0;
  for (const [medicineId, quantity] of merged) {
    const med = d.medicines.find((m) => m.id === medicineId);
    if (!med) throw badRequest("A medicine in your cart no longer exists");
    const stock = stockFor(pharmacy.id, medicineId); // availability is pharmacy-specific
    if (!stock || stock.quantity < quantity) throw conflict(`${med.name} is not available in the quantity you chose at this pharmacy`);
    if (med.prescriptionRequired) needsRx = true;
    if (med.restricted) hasRestricted = true;
    items.push({ id: `${orderId}_i${++n}`, orderId, medicineId, name: med.name, strength: med.strength, quantity, mrp: stock.mrp, unitPrice: stock.sellingPrice, prescriptionRequired: med.prescriptionRequired });
  }

  // --- Prescription rules: never bypassable ---
  const rx = input.prescriptionId ? d.prescriptions.find((p) => p.id === input.prescriptionId && p.userId === user.id) : undefined;
  if (input.prescriptionId && !rx) throw badRequest("Prescription not found");
  if (rx?.status === "REJECTED") throw badRequest("This prescription was rejected. Please upload a new one.");
  if (needsRx && !rx) throw badRequest("A valid prescription is required for the prescription medicines in your cart");
  if (hasRestricted && rx?.status !== "APPROVED") throw badRequest("Restricted medicines can only be ordered with an already-approved prescription");

  const cfg = settings();
  const subtotal = items.reduce((s, i) => s + i.unitPrice * i.quantity, 0);
  const fee = deliveryFee(subtotal, input.deliveryType, cfg);
  const code = input.offerCode?.toUpperCase();
  const offer = code ? d.offers.find((o) => o.code === code) : undefined;
  if (input.offerCode && !offer) throw badRequest("This offer code is not valid");
  const discount = applyOffer(subtotal, offer);
  const total = subtotal + fee - discount;

  const riderAvailable = d.deliveryPartners.some((p) => p.available && p.verification === "VERIFIED");
  const dist = address.location ? distanceKm(address.location, pharmacy.location) : 2;
  const eta = estimateEta({ distanceKm: dist, prepMinutes: pharmacy.avgPrepMinutes, needsPrescriptionReview: needsRx, riderAvailable, deliveryType: input.deliveryType });

  const { id: _a, userId: _u, ...snap } = address;
  void _a; void _u;
  const provider = providerFor(input.paymentMethod);
  const pay = provider.initiate({ id: orderId, total });
  const now = new Date().toISOString();
  const initial: OrderStatus = needsRx ? "PRESCRIPTION_REVIEW" : "PENDING";
  const order: Order = {
    id: orderId, code: orderCode(), userId: user.id, familyMemberId: input.familyMemberId, pharmacyId: pharmacy.id, addressId: address.id, addressSnapshot: snap,
    items, prescriptionId: rx?.id, status: initial, statusHistory: [{ status: initial, at: now, by: "CUSTOMER" }],
    deliveryType: input.deliveryType, subtotal, deliveryFee: fee, discount, total, paymentMethod: input.paymentMethod, paymentStatus: pay.status,
    etaMinutes: eta.minutes, deliveryOtp: otp(), pickupOtp: otp(), isRepeat: input.isRepeat, createdAt: now,
  };
  if (rx) { rx.status = rx.status === "APPROVED" ? "APPROVED" : "UNDER_REVIEW"; rx.pharmacyId = pharmacy.id; }
  d.orders.unshift(order);
  d.payments.push({ id: uid("pay"), orderId, userId: user.id, method: input.paymentMethod, provider: provider.name, amount: total, status: pay.status, providerRef: pay.providerRef, createdAt: now });
  notify(user.id, "ORDER_PLACED", "Order placed", `Order ${order.code} was sent to ${pharmacy.name}.`);
  // The cart has served its purpose
  d.carts = d.carts.filter((c) => c.userId !== user.id);
  return order;
}

/** UPI/card payment completion (mock gateway in V1; a real gateway calls this from its verified webhook). */
export function confirmPayment(user: SessionUser, orderId: string, providerRef: string) {
  const o = getOrderFor(user, orderId);
  if (o.userId !== user.id) throw forbidden();
  if (o.paymentStatus === "PAID") return o;
  if (o.paymentMethod === "COD") throw badRequest("This order is Cash on Delivery");
  if (o.status === "CANCELLED") throw conflict("This order was cancelled");
  o.paymentStatus = providerFor(o.paymentMethod).capture(o, providerRef).status;
  const pay = db().payments.find((p) => p.orderId === o.id);
  if (pay) { pay.status = o.paymentStatus; pay.providerRef = providerRef; }
  return o;
}

export function getOrderFor(user: SessionUser, orderId: string): Order {
  const o = db().orders.find((x) => x.id === orderId || x.code === orderId);
  if (!o) throw notFound("Order not found");
  const staff = (user.role === "PHARMACY_ADMIN" || user.role === "PHARMACIST") && user.partnerId === o.pharmacyId;
  const rider = user.role === "DELIVERY_PARTNER" && user.partnerId === o.deliveryPartnerId;
  if (!(o.userId === user.id || staff || rider || user.role === "SUPER_ADMIN")) throw forbidden();
  return o;
}

export const listOrdersFor = (user: SessionUser): Order[] => db().orders.filter((o) => o.userId === user.id);

/** Customer cancels (allowed until pickup); pharmacy/admin cancellations also go through here. */
export function cancelOrder(user: SessionUser, orderId: string, reason: string) {
  const o = getOrderFor(user, orderId);
  if (user.role === "CUSTOMER" && o.userId !== user.id) throw forbidden();
  if (isFinal(o.status)) throw conflict("This order is already closed");
  if (user.role === "CUSTOMER" && ["PICKED_UP", "OUT_FOR_DELIVERY"].includes(o.status)) throw conflict("This order can no longer be cancelled because it is already on its way");
  transition(o, "CANCELLED", user, reason);
  if (user.role !== "CUSTOMER") audit(user, "ORDER_CANCELLED", "Order", o.id, { reason });
  notify(o.userId, "ORDER_CANCELLED", "Order cancelled", `Order ${o.code} was cancelled.${o.paymentStatus === "REFUNDED" ? " Your payment will be refunded." : ""}`);
  return o;
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
  o.statusHistory.push({ status: o.status, at: new Date().toISOString(), note: "New prescription attached", by: "CUSTOMER" });
  return o;
}

// ───────────────────────── Pharmacy side ─────────────────────────

function ownPharmacyOrder(user: SessionUser, orderId: string): Order {
  const o = db().orders.find((x) => x.id === orderId);
  if (!o) throw notFound("Order not found");
  if (o.pharmacyId !== user.partnerId) throw forbidden();
  return o;
}

/** Pharmacist verification of the prescription attached to an order. Never edits or substitutes items. */
export function reviewOrderPrescription(user: SessionUser, orderId: string, decision: "APPROVE" | "REJECT" | "CLARIFY", note?: string) {
  const o = ownPharmacyOrder(user, orderId);
  if (o.status !== "PRESCRIPTION_REVIEW") throw conflict("This order is not waiting for prescription review");
  const rx = db().prescriptions.find((p) => p.id === o.prescriptionId);
  if (!rx) throw conflict("This order has no prescription attached");
  rx.reviewedBy = user.id;
  rx.reviewNote = note;
  if (decision === "APPROVE") {
    rx.status = "APPROVED";
    transition(o, "PRESCRIPTION_APPROVED", user, note ?? "Prescription verified");
    notify(o.userId, "PRESCRIPTION_APPROVED", "Prescription approved", `The pharmacist approved the prescription for order ${o.code}.`);
  } else if (decision === "REJECT") {
    if (!note?.trim()) throw badRequest("Please tell the customer why the prescription was rejected");
    if (rx.status !== "APPROVED") rx.status = "REJECTED";
    transition(o, "CANCELLED", user, note);
    notify(o.userId, "ORDER_CANCELLED", "Prescription could not be verified", `Order ${o.code} was cancelled. ${note}`);
  } else {
    if (!note?.trim()) throw badRequest("Tell the customer what is unclear");
    rx.status = "NEEDS_CLARIFICATION";
    o.statusHistory.push({ status: o.status, at: new Date().toISOString(), note: `Clearer prescription needed: ${note}`, by: user.role });
    notify(o.userId, "PRESCRIPTION_APPROVED", "Prescription needs a clearer copy", `Please upload a clearer prescription for order ${o.code}.`);
  }
  audit(user, `PRESCRIPTION_${decision}`, "Order", o.id, { prescriptionId: rx.id, note });
  return o;
}

/** Standalone review (e.g. a "Call Me" prescription that has no order yet). */
export function reviewPrescription(user: SessionUser, rxId: string, decision: "APPROVE" | "REJECT" | "CLARIFY", note?: string) {
  const d = db();
  const rx = d.prescriptions.find((p) => p.id === rxId);
  if (!rx) throw notFound("Prescription not found");
  const linked = d.orders.some((o) => o.prescriptionId === rx.id && !isFinal(o.status));
  if (linked) throw conflict("Review this prescription from its order");
  if (rx.source !== "QUICK_ORDER" && rx.pharmacyId !== user.partnerId) throw forbidden();
  if (!["RECEIVED", "UNDER_REVIEW", "NEEDS_CLARIFICATION"].includes(rx.status)) throw conflict("This prescription was already reviewed");
  rx.reviewedBy = user.id;
  rx.reviewNote = note;
  rx.pharmacyId ??= user.partnerId;
  rx.status = decision === "APPROVE" ? "APPROVED" : decision === "REJECT" ? "REJECTED" : "NEEDS_CLARIFICATION";
  audit(user, `PRESCRIPTION_${decision}`, "Prescription", rx.id, { note });
  if (decision === "APPROVE") notify(rx.userId, "PRESCRIPTION_APPROVED", "Prescription approved", "Your prescription was verified by the pharmacist.");
  return rx;
}

export type PharmacyStep = "confirm" | "prepare" | "ready";
const STEP_TARGET: Record<PharmacyStep, OrderStatus> = { confirm: "CONFIRMED", prepare: "PREPARING", ready: "READY_FOR_PICKUP" };

/** confirm → prepare → ready. Each is a validated state-machine transition. */
export function advanceAsPharmacy(user: SessionUser, orderId: string, step: PharmacyStep) {
  const o = ownPharmacyOrder(user, orderId);
  transition(o, STEP_TARGET[step], user);
  if (step === "confirm") {
    notify(o.userId, "ORDER_CONFIRMED", "Order confirmed", `${db().pharmacies.find((p) => p.id === o.pharmacyId)?.name} confirmed order ${o.code}.`);
    audit(user, "ORDER_CONFIRMED", "Order", o.id);
  }
  return o;
}

export function rejectOrder(user: SessionUser, orderId: string, note: string) {
  const o = ownPharmacyOrder(user, orderId);
  if (!note.trim()) throw badRequest("Please tell the customer why");
  if (["PICKED_UP", "OUT_FOR_DELIVERY"].includes(o.status)) throw conflict("This order is already out for delivery");
  transition(o, "CANCELLED", user, note);
  audit(user, "ORDER_REJECTED", "Order", o.id, { note });
  notify(o.userId, "ORDER_CANCELLED", "Order could not be accepted", `Order ${o.code} was not accepted by the pharmacy.${o.paymentStatus === "REFUNDED" ? " Your payment will be refunded." : ""}`);
  return o;
}

export function riderLoad(partnerId: string): number {
  return db().orders.filter((o) => o.deliveryPartnerId === partnerId && ACTIVE_RIDER_STATUSES.includes(o.status)).length;
}

/** Links a rider to an order that is READY_FOR_PICKUP. First valid claim wins. */
export function assignPartner(o: Order, partner: DeliveryPartner, actor: SessionUser) {
  if (o.deliveryPartnerId) throw conflict("This delivery was already taken");
  if (partner.verification !== "VERIFIED") throw forbidden("This rider is not verified");
  if (riderLoad(partner.id) >= MAX_ACTIVE_JOBS) throw conflict(`You already have ${MAX_ACTIVE_JOBS} active deliveries`);
  transition(o, "RIDER_ASSIGNED", actor);
  o.deliveryPartnerId = partner.id;
  const cfg = settings();
  db().deliveries.push({
    id: uid("dl"), orderId: o.id, partnerId: partner.id, status: "ASSIGNED", payout: o.deliveryType === "PRIORITY" ? cfg.riderPayoutPriority : cfg.riderPayoutNormal,
    cashToCollect: o.paymentMethod === "COD" ? o.total : 0, acceptedAt: new Date().toISOString(),
  });
  notify(o.userId, "RIDER_ASSIGNED", "Delivery partner assigned", `${partner.name} will deliver order ${o.code}.`);
}

/** Pharmacy-initiated assignment (nearest available rider unless one is chosen). */
export function assignRider(user: SessionUser, orderId: string, partnerId?: string) {
  const o = ownPharmacyOrder(user, orderId);
  if (o.status !== "READY_FOR_PICKUP") throw conflict("Mark the order ready for pickup before assigning a rider");
  const d = db();
  const ph = d.pharmacies.find((p) => p.id === o.pharmacyId)!;
  const eligible = d.deliveryPartners.filter((p) => p.available && p.verification === "VERIFIED" && riderLoad(p.id) < MAX_ACTIVE_JOBS);
  const partner = partnerId
    ? eligible.find((p) => p.id === partnerId)
    : [...eligible].sort((a, b) => (a.location ? distanceKm(a.location, ph.location) : 99) - (b.location ? distanceKm(b.location, ph.location) : 99))[0];
  if (!partner) throw conflict("No delivery partner is available right now. Riders can also accept it from their app.");
  assignPartner(o, partner, user);
  audit(user, "RIDER_ASSIGNED", "Order", o.id, { partnerId: partner.id });
  return o;
}

export function pharmacyOrders(user: SessionUser): Order[] {
  return db().orders.filter((o) => o.pharmacyId === user.partnerId);
}

/** What a pharmacy sees of an order: items and the patient name/age/allergies it needs; area, not full address. */
export function pharmacyOrderView(o: Order) {
  const d = db();
  const rx = d.prescriptions.find((p) => p.id === o.prescriptionId);
  const fm = d.familyMembers.find((f) => f.id === o.familyMemberId);
  const rider = d.deliveryPartners.find((p) => p.id === o.deliveryPartnerId);
  return {
    id: o.id, code: o.code, status: o.status, items: o.items, total: o.total, deliveryType: o.deliveryType, paymentMethod: o.paymentMethod, paymentStatus: o.paymentStatus,
    createdAt: o.createdAt, etaMinutes: o.etaMinutes, note: o.statusHistory.at(-1)?.note,
    pickupOtp: ["READY_FOR_PICKUP", "RIDER_ASSIGNED"].includes(o.status) ? o.pickupOtp : undefined,
    patient: fm ? { name: fm.name, age: fm.age, allergies: fm.allergies } : { name: d.users.find((u) => u.id === o.userId)?.name ?? "Customer" },
    area: `${o.addressSnapshot.area}, ${o.addressSnapshot.pincode}`,
    rider: rider ? { name: rider.name, mobile: rider.mobile } : undefined,
    prescription: rx && { id: rx.id, status: rx.status, mimeType: rx.mimeType, note: rx.reviewNote },
  };
}

// ───────────────────────── Customer view & quote ─────────────────────────

export function userSafeOrder(o: Order, viewer: Pick<SessionUser, "role">) {
  const d = db();
  const ph = d.pharmacies.find((p) => p.id === o.pharmacyId);
  const partner = d.deliveryPartners.find((p) => p.id === o.deliveryPartnerId);
  const onTheWay = ACTIVE_RIDER_STATUSES.includes(o.status);
  const customer = viewer.role === "CUSTOMER";
  return {
    ...o,
    // Delivery OTP is shown to the customer only; the pickup OTP only to pharmacy staff; never both to anyone else.
    deliveryOtp: customer && onTheWay ? o.deliveryOtp : undefined,
    pickupOtp: (viewer.role === "PHARMACIST" || viewer.role === "PHARMACY_ADMIN") && ["READY_FOR_PICKUP", "RIDER_ASSIGNED"].includes(o.status) ? o.pickupOtp : undefined,
    pharmacy: ph && { id: ph.id, name: ph.name, mobile: ph.mobile, address: ph.address },
    rider: partner && onTheWay ? { name: partner.name, mobile: partner.mobile, vehicle: partner.vehicle } : undefined,
    canCancel: customer && !isFinal(o.status) && !["PICKED_UP", "OUT_FOR_DELIVERY"].includes(o.status),
    stockReserved: undefined,
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
  const dist = address.location ? distanceKm(address.location, pharmacy.location) : 2;
  const eta = (deliveryType: "NORMAL" | "PRIORITY") => estimateEta({ distanceKm: dist, prepMinutes: pharmacy.avgPrepMinutes, needsPrescriptionReview: needsRx, riderAvailable, deliveryType });
  const code = input.offerCode?.toUpperCase();
  const offer = code ? d.offers.find((o) => o.code === code) : undefined;
  const discount = applyOffer(subtotal, offer);
  const total = (t: "NORMAL" | "PRIORITY") => subtotal + deliveryFee(subtotal, t, cfg) - discount;
  return {
    subtotal, discount, needsRx, offerValid: !input.offerCode || !!offer,
    normal: { fee: deliveryFee(subtotal, "NORMAL", cfg), total: total("NORMAL"), eta: eta("NORMAL") },
    priority: pharmacy.priorityDelivery ? { fee: deliveryFee(subtotal, "PRIORITY", cfg), total: total("PRIORITY"), eta: eta("PRIORITY") } : null,
  };
}
