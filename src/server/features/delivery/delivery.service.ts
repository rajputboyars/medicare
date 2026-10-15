import { distanceKm } from "@/lib/geo";
import type { DeliveryPartner, Order, RiderStatus, SessionUser } from "@/lib/types";
import { badRequest, conflict, forbidden, notFound } from "@/server/errors";
import { notify } from "@/server/features/notifications/notify";
import { MAX_OTP_ATTEMPTS, otpMatches } from "@/server/features/delivery/otp";
import { track } from "@/server/analytics";
import { audit, db } from "@/server/store";
import { ACTIVE_RIDER_STATUSES, assignPartner, deliveryOf, riderLoad, transition } from "@/server/features/orders/orders.service";

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
 * Deliveries a rider can claim: READY_FOR_PICKUP and nobody assigned yet.
 * Customer identity and the exact address stay hidden until the rider accepts.
 */
export function availableDeliveries(user: SessionUser) {
  const p = partnerOf(user);
  if (!p.available || p.verification !== "VERIFIED") return [];
  const d = db();
  return d.orders
    .filter((o) => o.status === "READY_FOR_PICKUP" && !o.deliveryPartnerId)
    .map((o) => {
      const ph = d.pharmacies.find((x) => x.id === o.pharmacyId)!;
      const cfg = d.settings[0];
      return {
        id: o.id, code: o.code, deliveryType: o.deliveryType, parcelCount: o.items.length,
        pharmacy: { name: ph.name, address: ph.address },
        toPharmacyKm: p.location ? distanceKm(p.location, ph.location) : undefined,
        dropKm: o.addressSnapshot.location ? distanceKm(ph.location, o.addressSnapshot.location) : undefined,
        dropArea: `${o.addressSnapshot.area}, ${o.addressSnapshot.pincode}`,
        payout: o.deliveryType === "PRIORITY" ? cfg.riderPayoutPriority : cfg.riderPayoutNormal,
        collectCash: o.paymentMethod === "COD" ? o.total : 0,
        readyAt: o.statusHistory.findLast((h) => h.status === "READY_FOR_PICKUP")?.at ?? o.createdAt,
      };
    })
    .sort((a, b) => (a.toPharmacyKm ?? 99) - (b.toPharmacyKm ?? 99) || a.readyAt.localeCompare(b.readyAt));
}

export function acceptDelivery(user: SessionUser, orderId: string) {
  const p = partnerOf(user);
  if (!p.available) throw conflict("Go online to accept deliveries");
  const o = db().orders.find((x) => x.id === orderId);
  if (!o) throw notFound("Delivery not found");
  if (o.status !== "READY_FOR_PICKUP" || o.deliveryPartnerId) throw conflict("This delivery was just taken by another rider");
  assignPartner(o, p, user);
  return riderView(o);
}

/** Everything a rider needs to deliver – and nothing medical: no medicine names, no prescription, no patient details. */
export function riderView(o: Order) {
  const d = db();
  const ph = d.pharmacies.find((p) => p.id === o.pharmacyId)!;
  const a = o.addressSnapshot;
  const dl = deliveryOf(o);
  return {
    id: o.id, code: o.code, status: o.status, deliveryType: o.deliveryType,
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
  return db().orders.filter((o) => o.deliveryPartnerId === p.id && ACTIVE_RIDER_STATUSES.includes(o.status)).map(riderView);
}

export type RiderStep = "ARRIVE" | "PICKUP" | "START" | "DELIVER" | "DROP";

/**
 * One step of the rider's job. Pickup and delivery each need a one-time code; the code is checked against a stored hash,
 * wrong guesses are counted, and after ${MAX_OTP_ATTEMPTS} wrong tries the step is locked until an admin looks at it.
 */
export function riderStep(user: SessionUser, orderId: string, step: RiderStep, code?: string) {
  const d = db();
  const p = partnerOf(user);
  const o = d.orders.find((x) => x.id === orderId);
  if (!o || o.deliveryPartnerId !== p.id) throw forbidden();
  const dl = deliveryOf(o);
  if (!dl || dl.partnerId !== p.id) throw conflict("No active delivery found for this order");
  const now = new Date().toISOString();

  if (step === "ARRIVE") {
    if (o.status !== "RIDER_ASSIGNED" || dl.status !== "ASSIGNED") throw conflict("This order is not waiting for you at the pharmacy");
    dl.status = "AT_PHARMACY";
    dl.atPharmacyAt = now;
  } else if (step === "PICKUP") {
    if (o.status !== "RIDER_ASSIGNED") throw conflict("This order is not waiting for pickup");
    if (dl.pickupAttempts >= MAX_OTP_ATTEMPTS) throw conflict("Too many wrong pickup codes. Please contact support.");
    if (!code || !otpMatches(dl.id, "PICKUP", code, dl.pickupOtpHash)) {
      dl.pickupAttempts++;
      audit(user, "PICKUP_OTP_FAILED", "Delivery", dl.id, { attempts: dl.pickupAttempts });
      throw badRequest("Pickup code is not correct. Ask the pharmacy for the 4-digit code.");
    }
    transition(o, "PICKED_UP", user);
    dl.status = "PICKED_UP";
    dl.pickedUpAt = now;
  } else if (step === "START") {
    transition(o, "OUT_FOR_DELIVERY", user);
    dl.status = "OUT_FOR_DELIVERY";
    dl.outForDeliveryAt = now;
    notify(o.userId, "OUT_FOR_DELIVERY", "Your order is on the way", `Order ${o.code} is out for delivery. Keep your delivery code ready.`);
  } else if (step === "DELIVER") {
    if (o.status !== "OUT_FOR_DELIVERY") throw conflict("Start the delivery first");
    if (dl.deliveryAttempts >= MAX_OTP_ATTEMPTS) throw conflict("Too many wrong delivery codes. Please contact support.");
    if (!code || !otpMatches(dl.id, "DELIVERY", code, dl.deliveryOtpHash)) {
      dl.deliveryAttempts++;
      audit(user, "DELIVERY_OTP_FAILED", "Delivery", dl.id, { attempts: dl.deliveryAttempts });
      throw badRequest("Delivery code is not correct. Ask the customer for the 4-digit code.");
    }
    transition(o, "DELIVERED", user);
    dl.status = "DELIVERED";
    dl.deliveredAt = now;
    if (o.paymentMethod === "COD") {
      o.paymentStatus = "PAID"; // rider collected cash
      const pay = d.payments.find((x) => x.orderId === o.id);
      if (pay) { pay.status = "PAID"; pay.paidAt = now; }
    }
    if (d.orders.filter((x) => x.userId === o.userId && x.status === "DELIVERED").length === 1) track("first_order_completed", { userId: o.userId });
    notify(o.userId, "ORDER_DELIVERED", "Order delivered", `Order ${o.code} was delivered. Thank you!`);
  } else {
    if (o.status !== "RIDER_ASSIGNED") throw conflict("You can only drop a delivery before pickup");
    transition(o, "READY_FOR_PICKUP", user, "Rider released the delivery");
  }
  return riderView(o);
}

export function deliveryHistory(user: SessionUser) {
  const d = db();
  const p = partnerOf(user);
  return d.deliveries
    .filter((x) => x.partnerId === p.id && x.status === "DELIVERED")
    .sort((a, b) => (b.deliveredAt ?? "").localeCompare(a.deliveredAt ?? ""))
    .slice(0, 100)
    .map((x) => {
      const o = d.orders.find((y) => y.id === x.orderId)!;
      return { id: x.id, orderCode: o.code, area: `${o.addressSnapshot.area}, ${o.addressSnapshot.pincode}`, payout: x.payout, cashCollected: x.cashToCollect, deliveredAt: x.deliveredAt! };
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
    cashCollectedToday: today.reduce((s, x) => s + x.cashToCollect, 0),
    days,
  };
}
