import { beforeEach, describe, expect, it } from "vitest";
import { availableQuantity, type SessionUser } from "@/lib/types";
import { TRANSITIONS, canTransition } from "@/lib/order-machine";
import { ORDER_STATUSES } from "@/lib/types";
import { MED } from "@/server/seed";
import { db, resetDb } from "@/server/store";
import { atomically } from "@/server/tx";
import { addCartItem, cancelMedicineRequest, createMedicineRequest, expireStaleRequests, getCart, removeCartItem, requestFor, respondToRequest, updateCartItem } from "@/server/features/medicine-requests/requests.service";
import { advanceAsPharmacy, assignRider, cancelOrder, codeFor, confirmPayment, createOrder, deliveryOf, expireUnpaidOrders, PAYMENT_WINDOW_MS, rejectOrder, transition } from "@/server/features/orders/orders.service";
import { acceptDelivery, riderStep, riderStatusOf } from "@/server/features/delivery/delivery.service";
import { coverageForLocation } from "@/server/features/service-areas/service-areas.service";
import { quickStockUpdate } from "@/server/features/pharmacy/pharmacy.service";
import { setServiceArea } from "@/server/features/admin/admin.service";

const customer: SessionUser = { id: "u_1", name: "Asha", role: "CUSTOMER" };
const customer2: SessionUser = { id: "u_2", name: "Rajesh", role: "CUSTOMER" };
const pharmacist: SessionUser = { id: "u_rx", name: "Kavita", role: "PHARMACIST", partnerId: "ph_1" };
const rider: SessionUser = { id: "u_dp4", name: "Vikas", role: "DELIVERY_PARTNER", partnerId: "dp_4" };
const admin: SessionUser = { id: "u_ad", name: "Admin", role: "SUPER_ADMIN" };
const base = { pharmacyId: "ph_1", addressId: "ad_1", deliveryType: "NORMAL" as const, paymentMethod: "COD" as const };
const otc = (qty = 2, who = customer, extra: Partial<typeof base> & { addressId?: string } = {}) => createOrder(who, { ...base, ...extra, items: [{ medicineId: MED.PARACETAMOL, quantity: qty }] });
const rows = (ph = "ph_1", med: string = MED.PARACETAMOL) => db().inventory.filter((i) => i.pharmacyId === ph && i.medicineId === med);
const sum = (f: (i: ReturnType<typeof rows>[number]) => number, ph?: string, med?: string) => rows(ph, med).reduce((s, i) => s + f(i), 0);
const shelf = (ph?: string, med?: string) => sum((i) => i.stockQuantity, ph, med);
const reserved = (ph?: string, med?: string) => sum((i) => i.reservedQuantity, ph, med);
const available = (ph?: string, med?: string) => sum(availableQuantity, ph, med);

beforeEach(() => resetDb());

describe("inventory reservation", () => {
  it("availableQuantity = stockQuantity - reservedQuantity", () => {
    expect(availableQuantity({ stockQuantity: 10, reservedQuantity: 4 })).toBe(6);
    expect(availableQuantity({ stockQuantity: 3, reservedQuantity: 9 })).toBe(0); // never negative
  });
  it("checkout reserves: the shelf count stays, the promised count goes up, availability goes down", () => {
    const s0 = shelf(), a0 = available();
    const o = otc(3);
    expect(shelf()).toBe(s0);
    expect(reserved()).toBeGreaterThanOrEqual(3);
    expect(available()).toBe(a0 - 3);
    expect(o.stockState).toBe("RESERVED");
    expect(o.stockAllocations.reduce((s, a) => s + a.quantity, 0)).toBe(3);
  });
  it("confirming consumes the reservation: shelf down, promised down, availability unchanged", () => {
    const o = otc(3);
    const s1 = shelf(), r1 = reserved(), a1 = available();
    advanceAsPharmacy(pharmacist, o.id, "confirm");
    expect(shelf()).toBe(s1 - 3);
    expect(reserved()).toBe(r1 - 3);
    expect(available()).toBe(a1);
    expect(o.stockState).toBe("CONSUMED");
  });
  it("cancelling before confirmation releases the promise without touching the shelf", () => {
    const s0 = shelf(), a0 = available(), r0 = reserved();
    const o = otc(3);
    cancelOrder(customer, o.id, "changed my mind");
    expect(shelf()).toBe(s0);
    expect(reserved()).toBe(r0);
    expect(available()).toBe(a0);
    expect(o.stockState).toBe("RELEASED");
  });
  it("cancelling after confirmation puts the units back on the shelf", () => {
    const s0 = shelf(), a0 = available();
    const o = otc(3);
    advanceAsPharmacy(pharmacist, o.id, "confirm");
    expect(shelf()).toBe(s0 - 3);
    cancelOrder(customer, o.id, "too slow");
    expect(shelf()).toBe(s0);
    expect(available()).toBe(a0);
    // and a second cancel cannot double-release
    expect(() => cancelOrder(customer, o.id, "again")).toThrow();
    expect(shelf()).toBe(s0);
  });
  it("a pharmacy rejecting an order releases its stock too", () => {
    const a0 = available();
    const o = otc(2);
    rejectOrder(pharmacist, o.id, "Out of stock today");
    expect(available()).toBe(a0);
    expect(o.status).toBe("CANCELLED");
  });
  it("overselling is impossible: the last units can only be promised once", () => {
    for (const i of rows()) { i.stockQuantity = 0; i.reservedQuantity = 0; }
    rows()[0].stockQuantity = 3;
    const first = otc(2);
    expect(first.status).toBe("PENDING");
    expect(available()).toBe(1);
    expect(() => otc(2, customer2, { addressId: "ad_3" })).toThrow(/not available in the quantity/);
    const second = otc(1, customer2, { addressId: "ad_3" });
    expect(second.status).toBe("PENDING");
    expect(available()).toBe(0);
    expect(() => otc(1, customer2, { addressId: "ad_3" })).toThrow();
    // Never more promised than exists
    expect(reserved()).toBeLessThanOrEqual(shelf());
  });
  it("many simultaneous buyers: total promised never exceeds the shelf", () => {
    for (const i of rows()) { i.stockQuantity = 0; i.reservedQuantity = 0; }
    rows()[0].stockQuantity = 10;
    let placed = 0;
    for (let n = 0; n < 25; n++) { try { otc(1); placed++; } catch { /* sold out */ } }
    expect(placed).toBe(10);
    expect(reserved()).toBe(10);
    expect(available()).toBe(0);
  });
  it("units come from the earliest-expiring batch first, and expired batches are never sold", () => {
    const a = rows()[0];
    const b = { ...a, id: "inv_extra", batch: "B-EARLY" };
    db().inventory.push(b);
    const now = Date.now();
    a.expiry = new Date(now + 100 * 86400_000).toISOString(); a.stockQuantity = 5; a.reservedQuantity = 0;
    b.expiry = new Date(now + 30 * 86400_000).toISOString(); b.stockQuantity = 5; b.reservedQuantity = 0;
    const o = otc(2);
    expect(o.stockAllocations).toEqual([{ inventoryId: b.id, quantity: 2 }]); // the 30-day batch
    b.expiry = new Date(now - 1000).toISOString(); // now expired
    expect(() => otc(6)).toThrow(); // only 5 valid units remain
  });
  it("a pharmacy cannot set stock below what is promised to open orders", () => {
    const o = otc(4);
    const row = db().inventory.find((i) => i.id === o.stockAllocations[0].inventoryId)!;
    expect(() => quickStockUpdate(pharmacist, row.id, row.reservedQuantity - 1)).toThrow(/promised to open orders/);
    quickStockUpdate(pharmacist, row.id, row.reservedQuantity);
    expect(row.stockQuantity).toBe(row.reservedQuantity);
  });
  it("an unpaid online order gives its stock back when the payment window passes; a paid one does not", () => {
    const a0 = available();
    const unpaid = createOrder(customer, { ...base, paymentMethod: "UPI", items: [{ medicineId: MED.PARACETAMOL, quantity: 2 }] });
    const paid = createOrder(customer2, { ...base, addressId: "ad_3", paymentMethod: "UPI", items: [{ medicineId: MED.PARACETAMOL, quantity: 1 }] });
    confirmPayment(customer2, paid.id, "ref_123");
    expect(available()).toBe(a0 - 3);
    expect(expireUnpaidOrders(Date.now() + PAYMENT_WINDOW_MS - 60_000)).toBe(0); // still inside the window
    expect(expireUnpaidOrders(Date.now() + PAYMENT_WINDOW_MS + 60_000)).toBe(1);
    expect(unpaid.status).toBe("CANCELLED");
    expect(unpaid.paymentStatus).toBe("FAILED");
    expect(paid.status).toBe("PENDING");
    expect(available()).toBe(a0 - 1);
    const h = db().orderStatusHistory.filter((x) => x.orderId === unpaid.id).at(-1)!;
    expect(h).toMatchObject({ toStatus: "CANCELLED", actorRole: "SYSTEM", changedBy: "system" });
  });
  it("a pharmacy cannot confirm an online order that has not been paid", () => {
    const o = createOrder(customer, { ...base, paymentMethod: "UPI", items: [{ medicineId: MED.PARACETAMOL, quantity: 1 }] });
    expect(() => advanceAsPharmacy(pharmacist, o.id, "confirm")).toThrow(/payment/i);
    confirmPayment(customer, o.id, "ref_9");
    expect(advanceAsPharmacy(pharmacist, o.id, "confirm").status).toBe("CONFIRMED");
  });
});

describe("checkout is all-or-nothing", () => {
  it("a failure part-way leaves no reservation, no order and no payment behind", () => {
    const before = { a: available(), r: reserved(), orders: db().orders.length, payments: db().payments.length, history: db().orderStatusHistory.length };
    // Second line is impossible, the first would have been reservable
    expect(() => createOrder(customer, { ...base, items: [{ medicineId: MED.PARACETAMOL, quantity: 2 }, { medicineId: MED.ORS, quantity: 9999 }] })).toThrow();
    expect({ a: available(), r: reserved(), orders: db().orders.length, payments: db().payments.length, history: db().orderStatusHistory.length }).toEqual(before);
  });
  it("atomically() restores everything it was asked to watch, and keeps object identity", () => {
    const row = db().inventory[0];
    const was = row.reservedQuantity;
    expect(() => atomically(["inventory", "orders"], () => { row.reservedQuantity += 50; db().orders.pop(); db().inventory.push({ ...row, id: "inv_new" }); throw new Error("boom"); })).toThrow("boom");
    expect(row.reservedQuantity).toBe(was);
    expect(db().inventory[0]).toBe(row);
    expect(db().inventory.some((i) => i.id === "inv_new")).toBe(false);
  });
});

describe("snapshots keep history correct", () => {
  it("an order keeps its address, medicine name and prices after the master data changes", () => {
    const o = otc(2);
    const snap = JSON.stringify({ a: o.addressSnapshot, i: o.items, t: o.total });
    const addr = db().addresses.find((a) => a.id === o.addressId)!;
    addr.landmark = "Moved house"; addr.area = "Elsewhere";
    const med = db().medicines.find((m) => m.id === MED.PARACETAMOL)!;
    med.name = "Renamed"; med.mrp = 999;
    for (const i of rows()) i.sellingPrice = 500;
    expect(JSON.stringify({ a: o.addressSnapshot, i: o.items, t: o.total })).toBe(snap);
    expect(o.addressSnapshot.landmark).not.toBe("Moved house");
    expect(o.items[0].name).not.toBe("Renamed");
  });
});

describe("order state machine and status ledger", () => {
  it("rejects every transition that is not on the map, for every actor", () => {
    const actors = ["CUSTOMER", "PHARMACY_ADMIN", "PHARMACIST", "DELIVERY_PARTNER", "SUPER_ADMIN", "SYSTEM"] as const;
    for (const from of ORDER_STATUSES) for (const to of ORDER_STATUSES) {
      const listed = TRANSITIONS[from].some((e) => e.to === to);
      for (const a of actors) if (!listed) expect(canTransition(from, to, a), `${from} → ${to} by ${a}`).toBe(false);
    }
  });
  it("PENDING cannot jump to DELIVERED and DELIVERED cannot go back", () => {
    const o = otc();
    expect(() => transition(o, "DELIVERED", rider)).toThrow(/cannot go from/);
    expect(() => transition(o, "PREPARING", pharmacist)).toThrow(); // must be confirmed first
    expect(() => transition(o, "READY_FOR_PICKUP", pharmacist)).toThrow();
    const done = db().orders.find((x) => x.status === "DELIVERED")!;
    for (const to of ORDER_STATUSES) expect(() => transition(done, to, admin)).toThrow();
    for (const to of ORDER_STATUSES) expect(() => transition(db().orders.find((x) => x.status === "CANCELLED")!, to, admin)).toThrow();
  });
  it("only the right role can make each move", () => {
    const o = otc();
    expect(() => transition(o, "CONFIRMED", customer)).toThrow(); // customers cannot confirm their own order
    expect(() => transition(o, "CONFIRMED", rider)).toThrow();
    advanceAsPharmacy(pharmacist, o.id, "confirm");
    expect(() => transition(o, "PICKED_UP", pharmacist)).toThrow();
  });
  it("writes one OrderStatusHistory row per transition: order, from, to, who, role, note, time", () => {
    const o = otc();
    advanceAsPharmacy(pharmacist, o.id, "confirm");
    advanceAsPharmacy(pharmacist, o.id, "prepare");
    advanceAsPharmacy(pharmacist, o.id, "ready");
    assignRider({ ...pharmacist }, o.id, "dp_4");
    riderStep(rider, o.id, "PICKUP", codeFor(deliveryOf(o)!, "PICKUP"));
    riderStep(rider, o.id, "START");
    riderStep(rider, o.id, "DELIVER", codeFor(deliveryOf(db().orders.find((x) => x.id === o.id)!) ?? db().deliveries.find((d) => d.orderId === o.id)!, "DELIVERY"));
    const h = db().orderStatusHistory.filter((x) => x.orderId === o.id);
    expect(h.map((x) => [x.fromStatus, x.toStatus])).toEqual([
      [undefined, "PENDING"], ["PENDING", "CONFIRMED"], ["CONFIRMED", "PREPARING"], ["PREPARING", "READY_FOR_PICKUP"],
      ["READY_FOR_PICKUP", "RIDER_ASSIGNED"], ["RIDER_ASSIGNED", "PICKED_UP"], ["PICKED_UP", "OUT_FOR_DELIVERY"], ["OUT_FOR_DELIVERY", "DELIVERED"],
    ]);
    expect(h[0]).toMatchObject({ orderId: o.id, changedBy: "u_1", actorRole: "CUSTOMER", note: "Order placed" });
    expect(h[1]).toMatchObject({ changedBy: "u_rx", actorRole: "PHARMACIST" });
    expect(h.at(-1)).toMatchObject({ changedBy: "u_dp4", actorRole: "DELIVERY_PARTNER" });
    expect(h.every((x) => !Number.isNaN(Date.parse(x.timestamp)))).toBe(true);
  });
  it("a refused transition writes nothing", () => {
    const o = otc();
    const n = db().orderStatusHistory.length;
    expect(() => transition(o, "DELIVERED", rider)).toThrow();
    expect(db().orderStatusHistory).toHaveLength(n);
    expect(o.status).toBe("PENDING");
  });
  it("a cancelled order refunds a paid payment and fails an unpaid one", () => {
    const paid = createOrder(customer, { ...base, paymentMethod: "UPI", items: [{ medicineId: MED.PARACETAMOL, quantity: 1 }] });
    confirmPayment(customer, paid.id, "ref_1");
    cancelOrder(customer, paid.id, "no longer needed");
    expect(db().payments.find((p) => p.orderId === paid.id)).toMatchObject({ status: "REFUNDED", refundedAmount: paid.total });
    const cod = otc();
    cancelOrder(customer, cod.id, "no longer needed");
    expect(db().payments.find((p) => p.orderId === cod.id)!.status).toBe("FAILED");
  });
});

describe("rider statuses and delivery statuses", () => {
  it("derives OFFLINE / AVAILABLE / BUSY / SUSPENDED", () => {
    const p = db().deliveryPartners.find((x) => x.id === "dp_4")!;
    p.available = false; expect(riderStatusOf(p)).toBe("OFFLINE");
    p.available = true; expect(riderStatusOf(p)).toBe("AVAILABLE");
    p.verification = "SUSPENDED"; expect(riderStatusOf(p)).toBe("SUSPENDED");
    p.verification = "VERIFIED";
    const o = otc();
    advanceAsPharmacy(pharmacist, o.id, "confirm"); advanceAsPharmacy(pharmacist, o.id, "prepare"); advanceAsPharmacy(pharmacist, o.id, "ready");
    acceptDelivery(rider, o.id);
    expect(riderStatusOf(p)).toBe("BUSY");
  });
  it("a delivery waits for a rider, is assigned, and goes back to waiting if the rider drops it", () => {
    const o = otc();
    advanceAsPharmacy(pharmacist, o.id, "confirm"); advanceAsPharmacy(pharmacist, o.id, "prepare"); advanceAsPharmacy(pharmacist, o.id, "ready");
    const dl = deliveryOf(o)!;
    expect(dl.status).toBe("WAITING_FOR_RIDER");
    expect(dl.partnerId).toBeUndefined();
    const code = codeFor(dl, "PICKUP");
    acceptDelivery(rider, o.id);
    expect(dl.status).toBe("ASSIGNED");
    riderStep(rider, o.id, "DROP");
    expect(dl.status).toBe("WAITING_FOR_RIDER");
    expect(codeFor(dl, "PICKUP")).toBe(code); // same codes after a re-assignment
  });
  it("a suspended rider cannot accept", () => {
    const o = otc();
    advanceAsPharmacy(pharmacist, o.id, "confirm"); advanceAsPharmacy(pharmacist, o.id, "prepare"); advanceAsPharmacy(pharmacist, o.id, "ready");
    db().deliveryPartners.find((x) => x.id === "dp_4")!.verification = "SUSPENDED";
    expect(() => acceptDelivery(rider, o.id)).toThrow();
  });
  it("cancelling marks an open delivery FAILED with the reason", () => {
    const o = otc();
    advanceAsPharmacy(pharmacist, o.id, "confirm"); advanceAsPharmacy(pharmacist, o.id, "prepare"); advanceAsPharmacy(pharmacist, o.id, "ready");
    cancelOrder(customer, o.id, "Not needed");
    const dl = db().deliveries.find((d) => d.orderId === o.id)!;
    expect(dl).toMatchObject({ status: "FAILED", failureReason: "Not needed" });
  });
});

describe("service areas: controlled rollout", () => {
  const loc = { pincode: "261001", state: "Uttar Pradesh", district: "Sitapur", town: "Sitapur" };
  it("ACTIVE areas accept orders; COMING_SOON and DISABLED fail gracefully with a clear message", () => {
    expect(coverageForLocation(loc)).toMatchObject({ available: true, status: "ACTIVE" });
    const area = db().serviceAreas.find((a) => a.pincode === "261001")!;
    setServiceArea(admin, area.id, "COMING_SOON");
    expect(coverageForLocation(loc)).toMatchObject({ available: false, status: "COMING_SOON" });
    expect(() => otc()).toThrow(/coming to your area/i);
    setServiceArea(admin, area.id, "DISABLED");
    expect(() => otc()).toThrow(/paused/i);
    expect(db().orders.filter((o) => o.userId === "u_1" && o.createdAt > new Date(Date.now() - 5000).toISOString())).toHaveLength(0);
    expect(db().audit.some((a) => a.action === "SERVICE_AREA_STATUS_CHANGED")).toBe(true);
  });
  it("the most specific area wins: a district can be live while one pincode stays off, and the reverse", () => {
    const d = db();
    d.serviceAreas = [{ id: "sa_d", level: "DISTRICT", name: "Sitapur", state: "Uttar Pradesh", district: "Sitapur", status: "ACTIVE" }, { id: "sa_p", level: "PINCODE", name: "261001", state: "Uttar Pradesh", district: "Sitapur", pincode: "261001", status: "DISABLED" }];
    expect(coverageForLocation(loc).available).toBe(false);
    expect(coverageForLocation({ ...loc, pincode: "261121" }).available).toBe(true); // falls back to the district
    d.serviceAreas = [{ id: "sa_s", level: "STATE", name: "Uttar Pradesh", state: "Uttar Pradesh", status: "ACTIVE" }, { id: "sa_t", level: "TOWN", name: "Biswan", state: "Uttar Pradesh", town: "Biswan", status: "COMING_SOON" }];
    expect(coverageForLocation({ pincode: "261125", state: "Uttar Pradesh", town: "Biswan" }).available).toBe(false);
    expect(coverageForLocation({ pincode: "261125", state: "Uttar Pradesh", town: "Sitapur" }).available).toBe(true);
    d.serviceAreas = [];
    expect(coverageForLocation(loc)).toMatchObject({ available: false, status: "UNKNOWN" });
  });
  it("an unsupported pincode (no area, no pharmacy delivering there) cannot check out", () => {
    const d = db();
    d.addresses.push({ ...d.addresses.find((a) => a.id === "ad_1")!, id: "ad_far", pincode: "110001", district: "New Delhi", town: "New Delhi", state: "Delhi" });
    expect(() => otc(1, customer, { addressId: "ad_far" })).toThrow(/coming to your area|does not deliver/i);
  });
  it("a pharmacy that does not serve the pincode is refused even inside a live area", () => {
    d_addPincodeArea("261125");
    expect(() => createOrder(customer, { ...base, pharmacyId: "ph_3", addressId: "ad_2", items: [{ medicineId: MED.METFORMIN, quantity: 1 }] })).toThrow();
  });
  function d_addPincodeArea(p: string) { if (!db().serviceAreas.some((a) => a.pincode === p)) db().serviceAreas.push({ id: "sa_x", level: "PINCODE", name: p, state: "Uttar Pradesh", pincode: p, status: "ACTIVE" }); }
});

describe("pharmacy verification at checkout", () => {
  it("an unverified, suspended or closed pharmacy cannot take orders", () => {
    const ph = db().pharmacies.find((p) => p.id === "ph_1")!;
    ph.verification = "PENDING"; expect(() => otc()).toThrow(/not available/);
    ph.verification = "SUSPENDED"; expect(() => otc()).toThrow(/not available/);
    ph.verification = "VERIFIED"; ph.acceptingOrders = false; expect(() => otc()).toThrow(/not taking orders/);
    ph.acceptingOrders = true; expect(otc().status).toBe("PENDING");
  });
});

describe("Find My Medicine", () => {
  const req = (over = {}) => createMedicineRequest({ medicineQuery: "Rare tonic", strength: "200 ml", quantity: 2, mobile: "9876543210", pincode: "261001", ...over }, "u_1");
  it("starts SEARCHING with an expiry, the patient and the service area", () => {
    const r = req({ familyMemberId: "fm_2" });
    expect(r).toMatchObject({ status: "SEARCHING", familyMemberId: "fm_2", strength: "200 ml", quantity: 2 });
    expect(Date.parse(r.expiresAt)).toBeGreaterThan(Date.now() + 20 * 3600_000);
    expect(r.serviceAreaId).toBeTruthy();
    expect(() => req({ familyMemberId: "fm_5" })).toThrow(); // someone else's family member
  });
  it("AVAILABLE marks FOUND; CAN_ARRANGE and ALTERNATIVE_AVAILABLE only inform; alternatives are suggestions, never substitutions", () => {
    const r = req();
    respondToRequest(pharmacist, r.id, "CAN_ARRANGE", { restockEta: "tomorrow" });
    expect(db().medicineRequests.find((x) => x.id === r.id)!.status).toBe("SEARCHING");
    expect(() => respondToRequest(pharmacist, r.id, "ALTERNATIVE_AVAILABLE", {})).toThrow(/suggest/i);
    respondToRequest(pharmacist, r.id, "ALTERNATIVE_AVAILABLE", { alternative: "Similar tonic 200 ml" });
    expect(db().medicineRequests.find((x) => x.id === r.id)!.status).toBe("SEARCHING");
    expect(db().orders.filter((o) => o.items.some((i) => /similar/i.test(i.name)))).toHaveLength(0); // nothing was ordered for them
    expect(() => respondToRequest(pharmacist, r.id, "AVAILABLE", { price: 100 })).toThrow(/prepare/i);
    respondToRequest(pharmacist, r.id, "AVAILABLE", { price: 100, availableQty: 3, prepMinutes: 10 });
    expect(db().medicineRequests.find((x) => x.id === r.id)!.status).toBe("FOUND");
  });
  it("NOT_FOUND once every asked pharmacy says not available", () => {
    const r = req();
    const asked = r.asked.map((p) => p.id);
    for (const id of asked) {
      const staff: SessionUser = { id: `x_${id}`, name: "s", role: "PHARMACY_ADMIN", partnerId: id };
      respondToRequest(staff, r.id, "NOT_AVAILABLE", {});
    }
    expect(db().medicineRequests.find((x) => x.id === r.id)!.status).toBe("NOT_FOUND");
    expect(() => respondToRequest(pharmacist, r.id, "AVAILABLE", { price: 1, availableQty: 1, prepMinutes: 1 })).toThrow(/closed/);
  });
  it("expires by itself: EXPIRED, or NOT_FOUND if everyone who replied said no", () => {
    const a = req(), b = req({ medicineQuery: "Other tonic" });
    respondToRequest(pharmacist, b.id, "NOT_AVAILABLE", {});
    expect(expireStaleRequests(Date.now() + 25 * 3600_000)).toBeGreaterThanOrEqual(2); // the two new ones, plus any seeded searches
    expect(db().medicineRequests.find((x) => x.id === a.id)!.status).toBe("EXPIRED");
    expect(db().medicineRequests.find((x) => x.id === b.id)!.status).toBe("NOT_FOUND");
  });
  it("can be cancelled by its owner only", () => {
    const r = req();
    expect(() => requestFor(customer2, r.id)).toThrow();
    expect(() => cancelMedicineRequest(customer2, r.id)).toThrow();
    expect(cancelMedicineRequest(customer, r.id).status).toBe("CANCELLED");
    expect(() => cancelMedicineRequest(customer, r.id)).toThrow(/closed/);
    expect(() => respondToRequest(pharmacist, r.id, "NOT_AVAILABLE", {})).toThrow(/closed/);
  });
  it("only pharmacies serving the request's pincode can answer", () => {
    const r = req({ pincode: "261125" });
    expect(() => respondToRequest(pharmacist, r.id, "NOT_AVAILABLE", {})).toThrow(); // ph_1 does not serve 261125
  });
});

describe("cart: one pharmacy per cart", () => {
  it("adds, updates and removes items, caps at available stock, and refuses a second pharmacy", () => {
    addCartItem(customer, { pharmacyId: "ph_1", medicineId: MED.PARACETAMOL, quantity: 2 });
    addCartItem(customer, { pharmacyId: "ph_1", medicineId: MED.PARACETAMOL, quantity: 1 });
    expect(getCart(customer).lines.find((l) => l.medicineId === MED.PARACETAMOL)!.quantity).toBe(3);
    expect(() => addCartItem(customer, { pharmacyId: "ph_2", medicineId: MED.PARACETAMOL, quantity: 1 })).toThrow(/another pharmacy/);
    expect(getCart(customer).pharmacyId).toBe("ph_1");
    expect(addCartItem(customer, { pharmacyId: "ph_2", medicineId: MED.PARACETAMOL, quantity: 1, replaceCart: true }).pharmacyId).toBe("ph_2");
    updateCartItem(customer, MED.PARACETAMOL, 4);
    expect(getCart(customer).lines[0].quantity).toBe(4);
    expect(() => updateCartItem(customer, MED.PARACETAMOL, 100000)).toThrow(/Only/);
    expect(() => updateCartItem(customer, MED.ORS, 1)).toThrow(/not in your cart/);
    removeCartItem(customer, MED.PARACETAMOL);
    expect(getCart(customer).lines).toHaveLength(0);
    expect(db().carts.some((c) => c.userId === "u_1")).toBe(false);
  });
  it("carts are per user, and an unverified pharmacy cannot be added", () => {
    addCartItem(customer, { pharmacyId: "ph_1", medicineId: MED.PARACETAMOL, quantity: 1 });
    expect(getCart(customer2).lines).toHaveLength(0);
    expect(() => addCartItem(customer, { pharmacyId: "ph_5", medicineId: MED.PARACETAMOL, quantity: 1 })).toThrow(/not available/);
  });
});

describe("payments", () => {
  it("COD starts PENDING and becomes PAID only when the rider delivers; the payment record mirrors the order", () => {
    const o = otc();
    const pay = () => db().payments.find((p) => p.orderId === o.id)!;
    expect(o.paymentStatus).toBe("PENDING");
    expect(pay()).toMatchObject({ provider: "COD", status: "PENDING", amount: o.total, refundedAmount: 0 });
    advanceAsPharmacy(pharmacist, o.id, "confirm"); advanceAsPharmacy(pharmacist, o.id, "prepare"); advanceAsPharmacy(pharmacist, o.id, "ready");
    acceptDelivery(rider, o.id);
    const dl = deliveryOf(o)!;
    riderStep(rider, o.id, "PICKUP", codeFor(dl, "PICKUP")); riderStep(rider, o.id, "START");
    riderStep(rider, o.id, "DELIVER", codeFor(db().deliveries.find((d) => d.orderId === o.id)!, "DELIVERY"));
    expect(o.paymentStatus).toBe("PAID");
    expect(pay()).toMatchObject({ status: "PAID" });
    expect(pay().paidAt).toBeTruthy();
  });
  it("one payment record per order; the amount is the server's total", () => {
    const o = otc(3);
    expect(db().payments.filter((p) => p.orderId === o.id)).toHaveLength(1);
    expect(db().payments.find((p) => p.orderId === o.id)!.amount).toBe(o.subtotal + o.deliveryFee - o.discount);
  });
});
