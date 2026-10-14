import type { MedicineRequest, Order, PaymentMethod, RequestResponseKind, SavedMedicine, SessionUser } from "@/lib/types";
import { badRequest, conflict, forbidden, notFound } from "@/server/errors";
import { stockFor as stockPrice } from "@/server/features/inventory/stock";
import { notify } from "@/server/features/notifications/notify";
import { audit, db, uid } from "@/server/store";
import { distanceKm } from "@/lib/geo";
import { offersFor, pincodeCenter } from "@/server/features/medicines/finder.service";
import { createOrder } from "@/server/features/orders/orders.service";
import { coverageFor } from "@/server/features/service-areas/service-areas.service";

// ───────────── "Find This Medicine For Me" ─────────────

/** How long a customer's search stays open before it expires on its own. */
export const REQUEST_TTL_MS = 24 * 3600_000;

export interface MedicineRequestInput { medicineQuery: string; strength?: string; quantity?: number; mobile: string; pincode: string; photoRxId?: string; prescriptionId?: string; familyMemberId?: string }

/** Broadcasts to verified pharmacies that serve the pincode. They answer with a MedicineRequestResponse. */
export function createMedicineRequest(input: MedicineRequestInput, userId?: string) {
  const d = db();
  expireStaleRequests();
  const cover = coverageFor(input.pincode);
  const targets = d.pharmacies.filter((p) => p.verification === "VERIFIED" && p.acceptingOrders && p.servicePincodes.includes(input.pincode));
  if (!targets.length || (cover.status !== "ACTIVE" && cover.status !== "UNKNOWN")) throw badRequest("We're coming to your area. No partner pharmacy covers this pincode yet.");
  if (input.prescriptionId && !d.prescriptions.some((p) => p.id === input.prescriptionId && p.userId === userId)) throw badRequest("Prescription not found");
  if (input.familyMemberId && !d.familyMembers.some((f) => f.id === input.familyMemberId && f.userId === userId)) throw badRequest("Unknown family member");
  const dup = d.medicineRequests.find((r) => r.status === "SEARCHING" && r.mobile === input.mobile && r.medicineQuery.toLowerCase() === input.medicineQuery.toLowerCase());
  const asked = targets.map((p) => ({ id: p.id, name: p.name }));
  if (dup) return { ...dup, pharmaciesNotified: targets.length, asked, responses: requestResponses(dup.id) };
  const name = input.medicineQuery.trim().toLowerCase();
  const r: MedicineRequest = {
    id: uid("req"), userId: userId ?? `guest:${input.mobile}`, medicineQuery: input.medicineQuery, strength: input.strength || undefined, quantity: input.quantity ?? 1,
    mobile: input.mobile, pincode: input.pincode, photoRxId: input.photoRxId, prescriptionId: input.prescriptionId, familyMemberId: input.familyMemberId,
    medicineId: d.medicines.find((m) => m.name.toLowerCase() === name)?.id, serviceAreaId: cover.areaId,
    status: "SEARCHING", expiresAt: new Date(Date.now() + REQUEST_TTL_MS).toISOString(), createdAt: new Date().toISOString(),
  };
  d.medicineRequests.unshift(r);
  return { ...r, pharmaciesNotified: targets.length, asked, responses: [] as ReturnType<typeof requestResponses> };
}

/** Searches that ran out of time close themselves: NOT_FOUND if every reply was "not available", otherwise EXPIRED. */
export function expireStaleRequests(at = Date.now()): number {
  const d = db();
  let n = 0;
  for (const r of d.medicineRequests) {
    if (r.status !== "SEARCHING" || Date.parse(r.expiresAt) > at) continue;
    const replies = d.medicineRequestResponses.filter((x) => x.requestId === r.id);
    r.status = replies.length && replies.every((x) => x.response === "NOT_AVAILABLE") ? "NOT_FOUND" : "EXPIRED";
    n++;
  }
  return n;
}

/** One request, only for the person who made it (or their mobile number, for guests who later signed up). */
export function requestFor(user: SessionUser, id: string) {
  const d = db();
  const r = d.medicineRequests.find((x) => x.id === id);
  const mobile = d.users.find((u) => u.id === user.id)?.mobile;
  if (!r) throw notFound("Request not found");
  if (r.userId !== user.id && r.mobile !== mobile && user.role !== "SUPER_ADMIN") throw forbidden();
  return { ...r, responses: requestResponses(r.id), asked: askedPharmacies(r.pincode) };
}

export function cancelMedicineRequest(user: SessionUser, id: string) {
  requestFor(user, id);
  const r = db().medicineRequests.find((x) => x.id === id)!;
  if (r.status !== "SEARCHING" && r.status !== "FOUND") throw conflict("This search is already closed");
  r.status = "CANCELLED";
  return r;
}

export function requestResponses(requestId: string) {
  const d = db();
  return d.medicineRequestResponses
    .filter((x) => x.requestId === requestId)
    .map((x) => ({ ...x, pharmacyName: d.pharmacies.find((p) => p.id === x.pharmacyId)?.name }));
}

/** The pharmacies a request is sent to: verified, taking orders and delivering to that pincode. */
export function askedPharmacies(pincode: string) {
  return db().pharmacies.filter((p) => p.verification === "VERIFIED" && p.acceptingOrders && p.servicePincodes.includes(pincode)).map((p) => ({ id: p.id, name: p.name }));
}

export function myRequests(user: SessionUser) {
  const d = db();
  expireStaleRequests();
  const mobile = d.users.find((u) => u.id === user.id)?.mobile;
  return d.medicineRequests
    .filter((r) => r.userId === user.id || r.mobile === mobile)
    .map((r) => ({ ...r, responses: requestResponses(r.id), asked: askedPharmacies(r.pincode) }));
}

/** Pharmacy replies to a request. Replying "AVAILABLE" marks it found and notifies the customer. */
export interface ResponseExtra { alternative?: string; restockEta?: string; price?: number; availableQty?: number; prepMinutes?: number }

export function respondToRequest(user: SessionUser, requestId: string, response: RequestResponseKind, extra: ResponseExtra) {
  expireStaleRequests();
  const d = db();
  const p = d.pharmacies.find((x) => x.id === user.partnerId);
  if (!p) throw forbidden();
  const r = d.medicineRequests.find((x) => x.id === requestId);
  if (!r) throw notFound();
  if (!p.servicePincodes.includes(r.pincode)) throw forbidden();
  if (r.status !== "SEARCHING" && r.status !== "FOUND") throw conflict("This request is closed");
  if (response === "ALTERNATIVE_AVAILABLE" && !extra.alternative?.trim()) throw badRequest("Say which medicine you suggest");
  if (response === "AVAILABLE" && (!extra.price || !extra.availableQty || !extra.prepMinutes)) throw badRequest("Add the price, how many you have and how long it takes to prepare");
  d.medicineRequestResponses = d.medicineRequestResponses.filter((x) => !(x.requestId === r.id && x.pharmacyId === p.id));
  d.medicineRequestResponses.push({ id: uid("rr"), requestId: r.id, pharmacyId: p.id, response, ...extra, at: new Date().toISOString() });
  if (response === "AVAILABLE" && r.status === "SEARCHING") {
    r.status = "FOUND";
    notify(r.userId, "MEDICINE_FOUND", "We found your medicine", `${p.name} has "${r.medicineQuery}". Open the app to order.`);
  } else if (response === "NOT_AVAILABLE" && r.status === "SEARCHING") {
    // Everyone who was asked has now said no
    const asked = askedPharmacies(r.pincode).map((x) => x.id);
    const answered = new Map(d.medicineRequestResponses.filter((x) => x.requestId === r.id).map((x) => [x.pharmacyId, x.response]));
    if (asked.every((id) => answered.get(id) === "NOT_AVAILABLE")) r.status = "NOT_FOUND";
  }
  audit(user, "MEDICINE_REQUEST_RESPONSE", "MedicineRequest", r.id, { response });
  return r;
}

export function openRequestsForPharmacy(user: SessionUser) {
  const d = db();
  expireStaleRequests();
  const p = d.pharmacies.find((x) => x.id === user.partnerId);
  if (!p) throw forbidden();
  return d.medicineRequests
    .filter((r) => (r.status === "SEARCHING" || r.status === "FOUND") && p.servicePincodes.includes(r.pincode))
    .map((r) => {
      const centre = pincodeCenter(r.pincode);
      const sharedFile = r.prescriptionId ?? r.photoRxId;
      return {
        id: r.id, medicineQuery: r.medicineQuery, strength: r.strength, quantity: r.quantity, pincode: r.pincode, createdAt: r.createdAt, status: r.status,
        ageMinutes: Math.max(0, Math.round((Date.now() - Date.parse(r.createdAt)) / 60_000)),
        distanceKm: centre ? distanceKm(centre, p.location) : undefined,
        area: `${d.pharmacies.find((x) => x.servicePincodes.includes(r.pincode))?.district ?? "Your area"}, ${r.pincode}`,
        // Pharmacies can open what the customer chose to share (photo or prescription), through the signed-URL route
        sharedFileId: sharedFile, hasPrescription: !!r.prescriptionId, hasPhoto: !!r.photoRxId,
        myResponse: d.medicineRequestResponses.find((x) => x.requestId === r.id && x.pharmacyId === p.id),
        repliesFromOthers: d.medicineRequestResponses.filter((x) => x.requestId === r.id && x.pharmacyId !== p.id).length,
      };
    })
    .sort((a, b) => Number(!!a.myResponse) - Number(!!b.myResponse) || a.createdAt.localeCompare(b.createdAt));
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

/** One pharmacy per cart in V1: adding from a different pharmacy is refused unless the caller asks to start a new cart. */
export function addCartItem(user: SessionUser, input: { pharmacyId: string; medicineId: string; quantity: number; replaceCart?: boolean }) {
  const d = db();
  if (!d.pharmacies.some((p) => p.id === input.pharmacyId && p.verification === "VERIFIED")) throw badRequest("This pharmacy is not available");
  if (!d.medicines.some((m) => m.id === input.medicineId)) throw badRequest("Unknown medicine");
  const stock = stockPrice(input.pharmacyId, input.medicineId);
  if (!stock) throw conflict("This medicine is not available at this pharmacy");
  const existing = d.carts.find((c) => c.userId === user.id);
  if (existing?.pharmacyId && existing.pharmacyId !== input.pharmacyId && existing.items.length && !input.replaceCart) {
    throw conflict("Your cart has medicines from another pharmacy. Finish that order first, or start a new cart.");
  }
  const cart = existing && existing.pharmacyId === input.pharmacyId ? existing : { id: uid("cart"), userId: user.id, pharmacyId: input.pharmacyId, prescriptionId: undefined, items: [] as { medicineId: string; quantity: number }[], updatedAt: "" };
  if (cart !== existing) d.carts = [...d.carts.filter((c) => c.userId !== user.id), cart];
  const line = cart.items.find((i) => i.medicineId === input.medicineId);
  const quantity = (line?.quantity ?? 0) + input.quantity;
  if (quantity > stock.quantity) throw conflict(`Only ${stock.quantity} available at this pharmacy`);
  if (line) line.quantity = quantity; else cart.items.push({ medicineId: input.medicineId, quantity });
  cart.updatedAt = new Date().toISOString();
  return getCart(user);
}

export function updateCartItem(user: SessionUser, medicineId: string, quantity: number) {
  const cart = db().carts.find((c) => c.userId === user.id);
  const line = cart?.items.find((i) => i.medicineId === medicineId);
  if (!cart || !line) throw notFound("That item is not in your cart");
  const stock = cart.pharmacyId ? stockPrice(cart.pharmacyId, medicineId) : undefined;
  if (!stock || quantity > stock.quantity) throw conflict(`Only ${stock?.quantity ?? 0} available at this pharmacy`);
  line.quantity = quantity;
  cart.updatedAt = new Date().toISOString();
  return getCart(user);
}

export function removeCartItem(user: SessionUser, medicineId: string) {
  const d = db();
  const cart = d.carts.find((c) => c.userId === user.id);
  if (!cart?.items.some((i) => i.medicineId === medicineId)) throw notFound("That item is not in your cart");
  cart.items = cart.items.filter((i) => i.medicineId !== medicineId);
  if (!cart.items.length) d.carts = d.carts.filter((c) => c.userId !== user.id);
  return getCart(user);
}

export function saveCart(user: SessionUser, input: { pharmacyId?: string; prescriptionId?: string; items: { medicineId: string; quantity: number }[] }) {
  const d = db();
  if (input.pharmacyId && !d.pharmacies.some((p) => p.id === input.pharmacyId)) throw badRequest("Unknown pharmacy");
  if (input.prescriptionId && !d.prescriptions.some((p) => p.id === input.prescriptionId && p.userId === user.id)) throw badRequest("Unknown prescription");
  d.carts = d.carts.filter((c) => c.userId !== user.id);
  if (input.items.length) d.carts.push({ id: uid("cart"), userId: user.id, pharmacyId: input.pharmacyId, prescriptionId: input.prescriptionId, items: input.items, updatedAt: new Date().toISOString() });
  return getCart(user);
}
