import { distanceKm } from "@/lib/geo";
import { FAILURE_REASONS, type Delivery, type DeliveryPartner, type FailureReason, type Order, type RiderStatus, type SessionUser } from "@/lib/types";
import { badRequest, conflict, forbidden, notFound } from "@/server/errors";
import { notify, notifyAdmins, notifyPharmacy } from "@/server/features/notifications/notify";
import { MAX_OTP_ATTEMPTS, otpMatches } from "@/server/features/delivery/otp";
import { recordCodCollection } from "@/server/features/payments/payment.service";
import { track } from "@/server/analytics";
import { audit, db } from "@/server/store";
import { atomically } from "@/server/tx";
import { ACTIVE_RIDER_STATUSES, assignPartner, deliveryOf, latestDelivery, noteOnOrder, riderBlocker, riderLoad, transition } from "@/server/features/orders/orders.service";

/** OFFLINE / AVAILABLE / BUSY / SUSPENDED, derived from the verification, the online switch and the active jobs. */
export function riderStatusOf(p: DeliveryPartner): RiderStatus {
  if (p.verification === "SUSPENDED" || p.verification === "REJECTED") return "SUSPENDED";
  if (!p.available) return "OFFLINE";
  return riderLoad(p.id) > 0 ? "BUSY" : "AVAILABLE";
}

export function partnerOf(user: SessionUser): DeliveryPartner {
  const p = db().deliveryPartners.find((x) => x.id === user.partnerId);
  if (!p) throw forbidden("No delivery profile is linked to this account");
  return p;
}

export function setAvailability(user: SessionUser, available: boolean) {
  const p = partnerOf(user);
  if (available && p.verification !== "VERIFIED") throw forbidden("Your account is waiting for verification. You can go online once it is approved.");
  if (!available && riderLoad(p.id) > 0) throw conflict("Finish your active deliveries before going offline");
  p.available = available;
  return p;
}

const startOfDay = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); };

export function riderSummary(user: SessionUser) {
  const p = partnerOf(user);
  const mine = db().deliveries.filter((x) => x.partnerId === p.id && x.status === "DELIVERED");
  const today = mine.filter((x) => Date.parse(x.deliveredAt ?? "") >= startOfDay());
  return {
    name: p.name, vehicle: p.vehicle, available: p.available, status: riderStatusOf(p), verification: p.verification,
    activeJobs: riderLoad(p.id),
    earningsToday: today.reduce((s, x) => s + x.payout, 0), deliveriesToday: today.length,
  };
}

/**
 * Deliveries a rider can claim: READY_FOR_PICKUP, nobody assigned, inside the rider's service area, and the rider is free.
 * An offer shows only what is needed to decide: where to pick up, the drop AREA (never the street address or the customer),
 * distances, cash to collect and what the rider will earn. No medicine names, prescription or health information.
 */
export function availableDeliveries(user: SessionUser) {
  const p = partnerOf(user);
  if (!p.available || p.verification !== "VERIFIED") return [];
  const d = db();
  return d.orders
    .filter((o) => o.status === "READY_FOR_PICKUP" && !o.deliveryPartnerId && !riderBlocker(p, o))
    .map((o) => {
      const ph = d.pharmacies.find((x) => x.id === o.pharmacyId)!;
      const dl = deliveryOf(o);
      return {
        id: o.id, code: o.code, deliveryType: o.deliveryType, parcelCount: o.items.length,
        pickup: { name: ph.name, address: ph.address },
        pharmacy: { name: ph.name, address: ph.address },
        toPharmacyKm: p.location ? Math.round(distanceKm(p.location, ph.location) * 10) / 10 : undefined,
        distanceKm: dl?.distanceKm ?? (o.addressSnapshot.location ? Math.round(distanceKm(ph.location, o.addressSnapshot.location) * 10) / 10 : undefined),
        dropKm: dl?.distanceKm,
        dropArea: `${o.addressSnapshot.area}, ${o.addressSnapshot.pincode}`,
        estimatedEarning: dl?.payout ?? 0,
        payout: dl?.payout ?? 0,
        collectCash: o.paymentMethod === "COD" ? o.total : 0,
        readyAt: o.statusHistory.findLast((h) => h.status === "READY_FOR_PICKUP")?.at ?? o.createdAt,
      };
    })
    .sort((a, b) => (a.toPharmacyKm ?? 99) - (b.toPharmacyKm ?? 99) || a.readyAt.localeCompare(b.readyAt));
}

/** Accept a delivery. Only one rider can win; asking again as the winner returns the same job (safe to retry). */
export function acceptDelivery(user: SessionUser, orderId: string) {
  return atomically(["orders", "orderStatusHistory", "deliveries", "notifications"], () => {
    const p = partnerOf(user);
    const o = db().orders.find((x) => x.id === orderId);
    if (!o) throw notFound("Delivery not found");
    if (o.deliveryPartnerId === p.id && ACTIVE_RIDER_STATUSES.includes(o.status)) return riderView(o); // retry by the same rider
    if (o.status !== "READY_FOR_PICKUP" || o.deliveryPartnerId) throw conflict("This delivery was just taken by another rider");
    assignPartner(o, p, user);
    return riderView(o);
  });
}

/** Everything a rider needs to deliver – and nothing medical: no medicine names, no prescription, no patient details. */
export function riderView(o: Order) {
  const d = db();
  const ph = d.pharmacies.find((p) => p.id === o.pharmacyId)!;
  const a = o.addressSnapshot;
  const dl = latestDelivery(o);
  return {
    id: o.id, code: o.code, status: o.status, deliveryType: o.deliveryType,
    delivery: dl && { id: dl.id, status: dl.status, attemptNo: dl.attemptNo ?? 1, failureReasonCode: dl.failureReasonCode },
    pharmacy: { name: ph.name, address: ph.address, mobile: ph.mobile, location: ph.location },
    customer: { name: a.contactName, mobile: a.contactMobile, address: `${a.houseDescription}, ${a.area}, ${a.village ? `${a.village}, ` : ""}${a.town} – ${a.pincode}`, landmark: a.landmark, location: a.location },
    parcelCount: o.items.length,
    collectCash: o.paymentMethod === "COD" ? o.total : 0,
    payout: dl?.payout ?? 0,
    etaMinutes: o.etaMinutes,
  };
}

export function activeDeliveries(user: SessionUser) {
  const p = partnerOf(user);
  return db().deliveries
    .filter((x) => x.partnerId === p.id && ["ASSIGNED", "AT_PHARMACY", "PICKED_UP", "OUT_FOR_DELIVERY", "DELIVERY_FAILED", "RETURNING_TO_PHARMACY"].includes(x.status))
    .map((x) => db().orders.find((o) => o.id === x.orderId)!)
    .filter(Boolean)
    .map(riderView);
}

export type RiderStep = "ARRIVE" | "PICKUP" | "START" | "DELIVER" | "DROP";

/**
 * One step of the rider's job. Pickup and delivery each need a one-time code; the code is checked against a stored hash,
 * wrong guesses are counted, and after ${MAX_OTP_ATTEMPTS} wrong tries the step is locked until support looks at it.
 *
 *  PICKUP   needs the pharmacy's pickup code (short-lived)  → order and delivery PICKED_UP
 *  DELIVER  needs the customer's code, and for cash on delivery the exact cash amount → order and delivery DELIVERED
 *           (cash is recorded first; repeating the call after success returns the same result)
 */
export function riderStep(user: SessionUser, orderId: string, step: RiderStep, code?: string, extra: { cashCollected?: number } = {}) {
  return riderStepInner(user, orderId, step, code, extra);
}

/** Everything that changes state on success runs inside one all-or-nothing block. Wrong-code counting happens OUTSIDE it, so a refused attempt is still counted. */
const STEP_COLLECTIONS = ["orders", "orderStatusHistory", "deliveries", "payments", "notifications", "audit", "inventory", "deliveryPartners"] as const;
const atomic = <T,>(fn: () => T) => atomically(STEP_COLLECTIONS, fn);

function riderStepInner(user: SessionUser, orderId: string, step: RiderStep, code: string | undefined, extra: { cashCollected?: number }) {
  const d = db();
  const p = partnerOf(user);
  const o = d.orders.find((x) => x.id === orderId);
  if (!o || o.deliveryPartnerId !== p.id) {
    // A repeated "complete" from the rider who already finished it is answered, not refused
    const done = o && latestDelivery(o);
    if (step === "DELIVER" && o && done?.status === "DELIVERED" && done.partnerId === p.id) return riderView(o);
    throw forbidden();
  }
  const dl = deliveryOf(o);
  if (!dl) {
    // Completing twice (a retry after a slow response) answers with the finished job instead of an error
    const last = latestDelivery(o);
    if (step === "DELIVER" && last?.status === "DELIVERED" && last.partnerId === p.id) return riderView(o);
    throw conflict("No active delivery found for this order");
  }
  if (dl.partnerId !== p.id) throw conflict("No active delivery found for this order");
  const now = new Date().toISOString();

  if (step === "ARRIVE") {
    if (dl.status === "AT_PHARMACY") return riderView(o);
    if (o.status !== "RIDER_ASSIGNED" || dl.status !== "ASSIGNED") throw conflict("This order is not waiting for you at the pharmacy");
    atomic(() => { dl.status = "AT_PHARMACY"; dl.atPharmacyAt = now; });
  } else if (step === "PICKUP") {
    if (o.status !== "RIDER_ASSIGNED") throw conflict("This order is not waiting for pickup");
    if (dl.pickupAttempts >= MAX_OTP_ATTEMPTS) throw conflict("Too many wrong pickup codes. Please ask the pharmacy for a new code or contact support.");
    if (dl.pickupOtpExpiresAt && Date.parse(dl.pickupOtpExpiresAt) < Date.now()) throw conflict("This pickup code has expired. Ask the pharmacy for a new one.");
    if (!code || !otpMatches(dl.id, "PICKUP", code, dl.pickupOtpHash)) {
      dl.pickupAttempts++;
      audit(user, "PICKUP_OTP_FAILED", "Delivery", dl.id, { attempts: dl.pickupAttempts });
      throw badRequest("Pickup code is not correct. Ask the pharmacy for the 4-digit code.");
    }
    atomic(() => { transition(o, "PICKED_UP", user); dl.status = "PICKED_UP"; dl.pickedUpAt = now; });
  } else if (step === "START") {
    if (o.status === "OUT_FOR_DELIVERY" && dl.status === "OUT_FOR_DELIVERY") return riderView(o);
    atomic(() => { transition(o, "OUT_FOR_DELIVERY", user); dl.status = "OUT_FOR_DELIVERY"; dl.outForDeliveryAt = now; });
  } else if (step === "DELIVER") {
    if (o.status !== "OUT_FOR_DELIVERY" || dl.status !== "OUT_FOR_DELIVERY") throw conflict("Start the delivery first");
    if (dl.deliveryAttempts >= MAX_OTP_ATTEMPTS) throw conflict("Too many wrong delivery codes. Please contact support.");
    if (dl.cashToCollect > 0 && extra.cashCollected !== dl.cashToCollect) throw badRequest(`Collect ₹${dl.cashToCollect} in cash from the customer first`);
    if (!code || !otpMatches(dl.id, "DELIVERY", code, dl.deliveryOtpHash)) {
      dl.deliveryAttempts++;
      audit(user, "DELIVERY_OTP_FAILED", "Delivery", dl.id, { attempts: dl.deliveryAttempts });
      throw badRequest("Delivery code is not correct. Ask the customer for the 4-digit code.");
    }
    atomic(() => {
      // Cash is recorded before the order is closed: a delivered COD order always has its money on record
      if (dl.cashToCollect > 0) {
        recordCodCollection(o.id, dl.cashToCollect);
        dl.cashCollectedAmount = dl.cashToCollect;
        dl.cashCollectedAt = now;
      }
      transition(o, "DELIVERED", user);
      dl.status = "DELIVERED";
      dl.deliveredAt = now;
      dl.lastLocation = undefined;
      audit(user, "DELIVERY_COMPLETED", "Delivery", dl.id, { orderId: o.id, cash: dl.cashCollectedAmount ?? 0 });
    });
    if (d.orders.filter((x) => x.userId === o.userId && x.status === "DELIVERED").length === 1) track("first_order_completed", { userId: o.userId });
  } else {
    if (o.status !== "RIDER_ASSIGNED") throw conflict("You can only drop a delivery before pickup");
    atomic(() => transition(o, "READY_FOR_PICKUP", user, "Rider released the delivery"));
  }
  return riderView(o);
}

// ───────────────────────── Failed delivery and return ─────────────────────────

const MAX_DELIVERY_ATTEMPTS = 3;
const HELD = ["PICKED_UP", "OUT_FOR_DELIVERY"] as const;

/**
 * The rider could not hand the parcel over. The order is NOT cancelled: the parcel is still in the rider's hands, so support decides
 * between trying again and bringing it back to the pharmacy. The customer, the pharmacy and support are told.
 */
export function reportFailedDelivery(user: SessionUser, orderId: string, reasonCode: FailureReason, note?: string) {
  if (!FAILURE_REASONS.includes(reasonCode)) throw badRequest("Choose why the delivery failed");
  if (reasonCode === "OTHER" && !note?.trim()) throw badRequest("Please describe what happened");
  return atomically(["orders", "orderStatusHistory", "deliveries", "notifications", "audit"], () => {
    const p = partnerOf(user);
    const o = db().orders.find((x) => x.id === orderId);
    if (!o || o.deliveryPartnerId !== p.id) throw forbidden();
    const dl = latestDelivery(o);
    if (dl?.status === "DELIVERY_FAILED" && dl.failureReasonCode === reasonCode) return riderView(o); // same report twice
    if (!dl || dl.partnerId !== p.id || !(HELD as readonly string[]).includes(dl.status)) throw conflict("You can only report a failed delivery after pickup");
    const before = { delivery: dl.status, attempt: dl.attemptNo };
    dl.status = "DELIVERY_FAILED";
    dl.failureReasonCode = reasonCode;
    dl.failureReason = note?.trim() || reasonCode;
    dl.failedAt = new Date().toISOString();
    dl.lastLocation = undefined;
    noteOnOrder(o, user, `Delivery attempt ${dl.attemptNo ?? 1} failed (${reasonCode})${note ? `: ${note}` : ""}`);
    audit(user, "DELIVERY_FAILED", "Delivery", dl.id, { orderId: o.id, reasonCode, note }, { before, after: { delivery: "DELIVERY_FAILED" } });
    notify(o.userId, "DELIVERY_FAILED", "We could not deliver your order", `The delivery partner could not hand over order ${o.code}. Our team will contact you to deliver again or arrange a return.`);
    notifyPharmacy(o.pharmacyId, "DELIVERY_FAILED", "Delivery failed", `Delivery of order ${o.code} failed (${reasonCode.replaceAll("_", " ").toLowerCase()}). Support will decide the next step.`);
    notifyAdmins("Delivery failed: action needed", `Order ${o.code}: ${reasonCode.replaceAll("_", " ").toLowerCase()}. Choose to retry the delivery or return the parcel to the pharmacy.`);
    return riderView(o);
  });
}

function failedDelivery(deliveryId: string): { dl: Delivery; o: Order } {
  const dl = db().deliveries.find((x) => x.id === deliveryId);
  if (!dl) throw notFound("Delivery not found");
  const o = db().orders.find((x) => x.id === dl.orderId)!;
  return { dl, o };
}

/** Support: try the same parcel again with the same rider (new attempt, fresh wrong-code counter). */
export function retryDelivery(admin: SessionUser, deliveryId: string, note?: string) {
  return atomically(["orders", "orderStatusHistory", "deliveries", "notifications", "audit"], () => {
    const { dl, o } = failedDelivery(deliveryId);
    if (dl.status === "OUT_FOR_DELIVERY") return dl; // already retried
    if (dl.status !== "DELIVERY_FAILED") throw conflict("Only a failed delivery can be retried");
    if ((dl.attemptNo ?? 1) >= MAX_DELIVERY_ATTEMPTS) throw conflict(`This parcel was already tried ${MAX_DELIVERY_ATTEMPTS} times. Return it to the pharmacy.`);
    const before = { status: dl.status, attempt: dl.attemptNo };
    dl.attemptNo = (dl.attemptNo ?? 1) + 1;
    dl.status = "OUT_FOR_DELIVERY";
    dl.deliveryAttempts = 0;
    dl.failedAt = undefined;
    noteOnOrder(o, admin, `Support asked for another delivery attempt (attempt ${dl.attemptNo})${note ? `: ${note}` : ""}`);
    audit(admin, "DELIVERY_RETRY", "Delivery", dl.id, { orderId: o.id, note }, { before, after: { status: dl.status, attempt: dl.attemptNo } });
    notify(o.userId, "OUT_FOR_DELIVERY", "We are trying again", `Order ${o.code} is out for delivery again. Keep your delivery code ready.`);
    return dl;
  });
}

/** Support: bring the parcel back. The order stays open until the pharmacy confirms it received the parcel. */
export function returnDelivery(admin: SessionUser, deliveryId: string, note?: string) {
  return atomically(["orders", "orderStatusHistory", "deliveries", "notifications", "audit"], () => {
    const { dl, o } = failedDelivery(deliveryId);
    if (dl.status === "RETURNING_TO_PHARMACY") return dl;
    if (dl.status !== "DELIVERY_FAILED") throw conflict("Only a failed delivery can be returned");
    const before = { status: dl.status };
    dl.status = "RETURNING_TO_PHARMACY";
    dl.returnStartedAt = new Date().toISOString();
    noteOnOrder(o, admin, `Parcel is being returned to the pharmacy${note ? `: ${note}` : ""}`);
    audit(admin, "DELIVERY_RETURN_STARTED", "Delivery", dl.id, { orderId: o.id, note }, { before, after: { status: dl.status } });
    notifyPharmacy(o.pharmacyId, "SUPPORT_ALERT", "A parcel is coming back", `The delivery partner is bringing order ${o.code} back to your pharmacy. Please confirm when it arrives.`);
    notify(o.userId, "DELIVERY_FAILED", "Your order is being returned", `Order ${o.code} is going back to the pharmacy. We will contact you about a refund or a new delivery.`);
    return dl;
  });
}

/** The pharmacy (or support) confirms the parcel is back. Support is alerted to cancel and refund, or reorder. */
export function confirmReturnReceived(user: SessionUser, orderId: string) {
  return atomically(["orders", "orderStatusHistory", "deliveries", "notifications", "audit"], () => {
    const o = db().orders.find((x) => x.id === orderId);
    if (!o) throw notFound("Order not found");
    if (user.role !== "SUPER_ADMIN" && o.pharmacyId !== user.partnerId) throw forbidden();
    const dl = latestDelivery(o);
    if (dl?.status === "RETURNED_TO_PHARMACY") return dl;
    if (!dl || dl.status !== "RETURNING_TO_PHARMACY") throw conflict("No parcel is on its way back for this order");
    dl.status = "RETURNED_TO_PHARMACY";
    dl.returnedAt = new Date().toISOString();
    dl.lastLocation = undefined;
    noteOnOrder(o, user, "Parcel received back at the pharmacy");
    audit(user, "DELIVERY_RETURNED", "Delivery", dl.id, { orderId: o.id }, { before: { status: "RETURNING_TO_PHARMACY" }, after: { status: "RETURNED_TO_PHARMACY" } });
    notifyAdmins("Parcel is back at the pharmacy", `Order ${o.code}: the parcel was returned. Cancel the order to refund the customer, or arrange a new delivery.`);
    return dl;
  });
}

// ───────────────────────── Location ─────────────────────────

/** Latest position only. Overwritten each time, rounded when shown to the customer, gone when the delivery ends. */
export function updateRiderLocation(user: SessionUser, orderId: string, point: { lat: number; lng: number }) {
  const p = partnerOf(user);
  const o = db().orders.find((x) => x.id === orderId);
  const dl = o && deliveryOf(o);
  if (!o || !dl || dl.partnerId !== p.id) throw forbidden("You can share your location only for your own active delivery");
  if (!["ASSIGNED", "AT_PHARMACY", "PICKED_UP", "OUT_FOR_DELIVERY", "RETURNING_TO_PHARMACY"].includes(dl.status)) throw conflict("Location sharing is only on during an active delivery");
  const at = new Date().toISOString();
  dl.lastLocation = { lat: point.lat, lng: point.lng, at };
  p.location = { lat: point.lat, lng: point.lng };
  return { ok: true, at };
}

// ───────────────────────── Rider history ─────────────────────────

export function deliveryHistory(user: SessionUser) {
  const d = db();
  const p = partnerOf(user);
  return d.deliveries
    .filter((x) => x.partnerId === p.id && x.status === "DELIVERED")
    .sort((a, b) => (b.deliveredAt ?? "").localeCompare(a.deliveredAt ?? ""))
    .slice(0, 100)
    .map((x) => {
      const o = d.orders.find((y) => y.id === x.orderId)!;
      return { id: x.id, orderCode: o.code, area: `${o.addressSnapshot.area}, ${o.addressSnapshot.pincode}`, payout: x.payout, cashCollected: x.cashCollectedAmount ?? 0, deliveredAt: x.deliveredAt! };
    });
}

export function earningsSummary(user: SessionUser) {
  const p = partnerOf(user);
  const done = db().deliveries.filter((x) => x.partnerId === p.id && x.status === "DELIVERED");
  const since = (ms: number) => done.filter((x) => Date.parse(x.deliveredAt ?? "") >= ms);
  const sum = (xs: typeof done) => xs.reduce((s, x) => s + x.payout, 0);
  const today = since(startOfDay());
  const week = since(Date.now() - 7 * 86400_000);
  const days = Array.from({ length: 7 }, (_, i) => {
    const day = new Date(); day.setHours(0, 0, 0, 0); day.setDate(day.getDate() - (6 - i));
    const next = day.getTime() + 86400_000;
    const xs = done.filter((x) => { const t = Date.parse(x.deliveredAt ?? ""); return t >= day.getTime() && t < next; });
    return { label: day.toLocaleDateString("en-IN", { weekday: "short" }), amount: sum(xs), count: xs.length };
  });
  return {
    today: { amount: sum(today), count: today.length },
    week: { amount: sum(week), count: week.length },
    total: { amount: sum(done), count: done.length },
    cashCollectedToday: today.reduce((s, x) => s + (x.cashCollectedAmount ?? 0), 0),
    days,
  };
}
