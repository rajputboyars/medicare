import type { Order, PaymentMethod, SavedMedicine, SessionUser } from "@/lib/types";
import { badRequest, forbidden, notFound } from "../errors";
import { stockFor as stockPrice } from "../inventory";
import { notify } from "../notifications";
import { db, uid } from "../store";
import { offersFor, pincodeCenter } from "./finder";
import { createOrder } from "./orders";

// ───────────── "Find This Medicine For Me" ─────────────

/** Broadcasts to verified pharmacies that serve the pincode. They answer with a MedicineRequestResponse. */
export function createMedicineRequest(input: { medicineQuery: string; mobile: string; pincode: string }, userId?: string) {
  const d = db();
  const targets = d.pharmacies.filter((p) => p.verification === "VERIFIED" && p.acceptingOrders && p.servicePincodes.includes(input.pincode));
  if (!targets.length) throw badRequest("We're coming to your area. No partner pharmacy covers this pincode yet.");
  const dup = d.medicineRequests.find((r) => r.status === "OPEN" && r.mobile === input.mobile && r.medicineQuery.toLowerCase() === input.medicineQuery.toLowerCase());
  if (dup) return { ...dup, pharmaciesNotified: targets.length };
  const r = { id: uid("req"), userId: userId ?? `guest:${input.mobile}`, medicineQuery: input.medicineQuery, mobile: input.mobile, pincode: input.pincode, status: "OPEN" as const, createdAt: new Date().toISOString() };
  d.medicineRequests.unshift(r);
  return { ...r, pharmaciesNotified: targets.length };
}

export function requestResponses(requestId: string) {
  const d = db();
  return d.medicineRequestResponses
    .filter((x) => x.requestId === requestId)
    .map((x) => ({ ...x, pharmacyName: d.pharmacies.find((p) => p.id === x.pharmacyId)?.name }));
}

export function myRequests(user: SessionUser) {
  const d = db();
  const mobile = d.users.find((u) => u.id === user.id)?.mobile;
  return d.medicineRequests.filter((r) => r.userId === user.id || r.mobile === mobile).map((r) => ({ ...r, responses: requestResponses(r.id) }));
}

/** Pharmacy replies to a request. Replying "AVAILABLE" marks it found and notifies the customer. */
export function respondToRequest(user: SessionUser, requestId: string, response: "AVAILABLE" | "ALTERNATIVE" | "OUT_OF_STOCK", extra: { alternative?: string; restockEta?: string }) {
  const d = db();
  const p = d.pharmacies.find((x) => x.id === user.partnerId);
  if (!p) throw forbidden();
  const r = d.medicineRequests.find((x) => x.id === requestId);
  if (!r) throw notFound();
  if (!p.servicePincodes.includes(r.pincode)) throw forbidden();
  d.medicineRequestResponses = d.medicineRequestResponses.filter((x) => !(x.requestId === r.id && x.pharmacyId === p.id));
  d.medicineRequestResponses.push({ id: uid("rr"), requestId: r.id, pharmacyId: p.id, response, ...extra, at: new Date().toISOString() });
  if (response === "AVAILABLE" && r.status === "OPEN") {
    r.status = "FOUND";
    notify(r.userId, "MEDICINE_FOUND", "We found your medicine", `${p.name} has "${r.medicineQuery}". Open the app to order.`);
  }
  return r;
}

export function openRequestsForPharmacy(user: SessionUser) {
  const d = db();
  const p = d.pharmacies.find((x) => x.id === user.partnerId);
  if (!p) throw forbidden();
  return d.medicineRequests
    .filter((r) => r.status !== "CLOSED" && p.servicePincodes.includes(r.pincode))
    .map((r) => ({ id: r.id, medicineQuery: r.medicineQuery, pincode: r.pincode, createdAt: r.createdAt, status: r.status, myResponse: d.medicineRequestResponses.find((x) => x.requestId === r.id && x.pharmacyId === p.id) }));
}

// ───────────── Saved medicines (refill-ready) ─────────────

export function listSaved(userId: string) {
  const d = db();
  return d.savedMedicines.filter((r) => r.userId === userId).map((r) => ({
    ...r,
    daysLeft: Math.ceil((Date.parse(r.nextRefillAt) - Date.now()) / 86400_000),
    meds: r.items.map((i) => ({ ...i, name: d.medicines.find((m) => m.id === i.medicineId)?.name ?? "Medicine", prescriptionRequired: !!d.medicines.find((m) => m.id === i.medicineId)?.prescriptionRequired })),
    forName: d.familyMembers.find((f) => f.id === r.familyMemberId)?.name,
  }));
}

export function saveMedicines(userId: string, input: Pick<SavedMedicine, "label" | "familyMemberId" | "items" | "everyDays" | "preferredPharmacyId">) {
  const d = db();
  if (input.items.some((i) => !d.medicines.some((m) => m.id === i.medicineId))) throw badRequest("Unknown medicine");
  if (input.familyMemberId && !d.familyMembers.some((f) => f.id === input.familyMemberId && f.userId === userId)) throw badRequest("Unknown family member");
  const r: SavedMedicine = { id: uid("sv"), userId, ...input, nextRefillAt: new Date(Date.now() + input.everyDays * 86400_000).toISOString(), reminderOn: true };
  d.savedMedicines.push(r);
  return r;
}

/** One tap on a delivered order: keep its medicines as a saved list with a refill cadence. */
export function saveFromOrder(user: SessionUser, orderId: string, everyDays = 30) {
  const o = db().orders.find((x) => x.id === orderId);
  if (!o) throw notFound();
  if (o.userId !== user.id) throw forbidden();
  return saveMedicines(user.id, { label: `From order ${o.code}`, familyMemberId: o.familyMemberId, items: o.items.map((i) => ({ medicineId: i.medicineId, quantity: i.quantity })), everyDays, preferredPharmacyId: o.pharmacyId });
}

export function toggleReminder(userId: string, id: string, on: boolean) {
  const r = db().savedMedicines.find((x) => x.id === id);
  if (!r) throw notFound();
  if (r.userId !== userId) throw forbidden();
  r.reminderOn = on;
  return r;
}

export function deleteSaved(userId: string, id: string) {
  const d = db();
  const r = d.savedMedicines.find((x) => x.id === id);
  if (!r) throw notFound();
  if (r.userId !== userId) throw forbidden();
  d.savedMedicines = d.savedMedicines.filter((x) => x.id !== id);
}

/** Sends refill reminders that are due (run from a scheduler; idempotent per day). Returns how many were sent. */
export function sendDueRefillReminders(now = Date.now()): number {
  let sent = 0;
  for (const r of db().savedMedicines) {
    const due = Date.parse(r.nextRefillAt) - now <= 3 * 86400_000;
    const already = r.lastReminderAt && now - Date.parse(r.lastReminderAt) < 86400_000;
    if (r.reminderOn && due && !already) {
      notify(r.userId, "REFILL_REMINDER", "Time to refill", `Your saved medicines "${r.label}" are due for a refill.`);
      r.lastReminderAt = new Date(now).toISOString();
      sent++;
    }
  }
  return sent;
}

/**
 * One-click reorder from saved medicines. NEVER auto-purchases prescription medicines: the new order goes through
 * the same prescription review as any other order and needs an on-file prescription.
 */
export function reorderSaved(user: SessionUser, savedId: string, addressId: string, paymentMethod: PaymentMethod): Order {
  const d = db();
  const r = d.savedMedicines.find((x) => x.id === savedId);
  if (!r) throw notFound();
  if (r.userId !== user.id) throw forbidden();
  const address = d.addresses.find((a) => a.id === addressId && a.userId === user.id);
  if (!address) throw badRequest("Choose a delivery address");
  const pharmacyId = r.preferredPharmacyId ?? offersFor(r.items[0].medicineId, address.pincode, pincodeCenter(address.pincode))[0]?.pharmacyId;
  if (!pharmacyId) throw badRequest("No nearby pharmacy has all these medicines right now");
  const needsRx = r.items.some((i) => d.medicines.find((m) => m.id === i.medicineId)?.prescriptionRequired);
  const rx = needsRx ? d.prescriptions.find((p) => p.userId === user.id && p.status === "APPROVED" && (!r.familyMemberId || p.familyMemberId === r.familyMemberId)) : undefined;
  if (needsRx && !rx) throw badRequest("Please upload a current prescription. Prescription medicines are never reordered without one.");
  const order = createOrder(user, { pharmacyId, addressId, familyMemberId: r.familyMemberId, items: r.items, prescriptionId: rx?.id, deliveryType: "NORMAL", paymentMethod, isRepeat: true });
  r.nextRefillAt = new Date(Date.now() + r.everyDays * 86400_000).toISOString();
  return order;
}

/** One-click repeat of a previous order: same items, pharmacy, address and payment. Same rules as a new order. */
export function repeatOrder(user: SessionUser, orderId: string, paymentMethod?: PaymentMethod): Order {
  const d = db();
  const o = d.orders.find((x) => x.id === orderId);
  if (!o) throw notFound();
  if (o.userId !== user.id) throw forbidden();
  const needsRx = o.items.some((i) => i.prescriptionRequired);
  const rx = needsRx ? d.prescriptions.find((p) => p.id === o.prescriptionId && p.userId === user.id) : undefined;
  if (needsRx && !rx) throw badRequest("Please upload a current prescription to repeat this order");
  const address = d.addresses.find((a) => a.id === o.addressId && a.userId === user.id);
  if (!address) throw badRequest("The delivery address of this order was removed. Please place a new order.");
  return createOrder(user, { pharmacyId: o.pharmacyId, addressId: o.addressId, familyMemberId: o.familyMemberId, items: o.items.map((i) => ({ medicineId: i.medicineId, quantity: i.quantity })), prescriptionId: rx?.id, deliveryType: o.deliveryType, paymentMethod: paymentMethod ?? o.paymentMethod, isRepeat: true });
}

// ───────────── Server-side cart ─────────────

/** The cart is stored per customer so it follows them across devices. Prices are always re-read from inventory. */
export function getCart(user: SessionUser) {
  const d = db();
  const c = d.carts.find((x) => x.userId === user.id);
  if (!c || !c.pharmacyId) return { pharmacyId: undefined, pharmacyName: undefined, prescriptionId: undefined, lines: [] };
  const ph = d.pharmacies.find((p) => p.id === c.pharmacyId);
  const lines = c.items.flatMap((i) => {
    const m = d.medicines.find((x) => x.id === i.medicineId);
    const stock = ph && stockPrice(ph.id, i.medicineId);
    return m && stock ? [{ medicineId: m.id, name: m.name, strength: m.strength, price: stock.sellingPrice, mrp: m.mrp, quantity: Math.min(i.quantity, stock.quantity), prescriptionRequired: m.prescriptionRequired }] : [];
  });
  return { pharmacyId: c.pharmacyId, pharmacyName: ph?.name, prescriptionId: c.prescriptionId, lines };
}

export function saveCart(user: SessionUser, input: { pharmacyId?: string; prescriptionId?: string; items: { medicineId: string; quantity: number }[] }) {
  const d = db();
  if (input.pharmacyId && !d.pharmacies.some((p) => p.id === input.pharmacyId)) throw badRequest("Unknown pharmacy");
  if (input.prescriptionId && !d.prescriptions.some((p) => p.id === input.prescriptionId && p.userId === user.id)) throw badRequest("Unknown prescription");
  d.carts = d.carts.filter((c) => c.userId !== user.id);
  if (input.items.length) d.carts.push({ id: uid("cart"), userId: user.id, pharmacyId: input.pharmacyId, prescriptionId: input.prescriptionId, items: input.items, updatedAt: new Date().toISOString() });
  return getCart(user);
}
