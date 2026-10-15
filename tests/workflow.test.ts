import { beforeEach, describe, expect, it } from "vitest";
import type { SessionUser } from "@/lib/types";
import { MED } from "@/server/seed";
import { availableQuantity } from "@/lib/types";
import { db, resetDb, settings } from "@/server/store";
import { offersFor, pincodeCenter, searchMedicines } from "@/server/features/medicines/finder.service";
import { codeFor, deliveryOf, advanceAsPharmacy, assignRider, attachPrescription, cancelOrder, confirmPayment, createOrder, getOrderFor, pharmacyOrderView, quoteOrder, rejectOrder, reviewOrderPrescription, reviewPrescription, userSafeOrder } from "@/server/features/orders/orders.service";
import { acceptDelivery, activeDeliveries, availableDeliveries, deliveryHistory, earningsSummary, riderStep, riderSummary, setAvailability } from "@/server/features/delivery/delivery.service";
import { storePrescription } from "@/server/features/prescriptions/prescriptions.service";
import { customersOf, paymentsOf, prescriptionQueue, quickStockUpdate, reportsOf, upsertInventory } from "@/server/features/pharmacy/pharmacy.service";
import { createMedicineRequest, getCart, myRequests, openRequestsForPharmacy, repeatOrder, reorderSaved, respondToRequest, saveCart, saveFromOrder, sendDueRefillReminders } from "@/server/features/medicine-requests/requests.service";
import { adminList, adminStats, attentionItems, coverageFor, generateSettlements, launchSignup, platformReports, setSettlementStatus, setVerification, updatePlatformSettings } from "@/server/features/admin/admin.service";

const customer: SessionUser = { id: "u_1", name: "Asha", role: "CUSTOMER" };
const pharmacist: SessionUser = { id: "u_rx", name: "Kavita", role: "PHARMACIST", partnerId: "ph_1" };
const owner: SessionUser = { id: "u_ph", name: "Ramesh", role: "PHARMACY_ADMIN", partnerId: "ph_1" };
const owner2: SessionUser = { id: "u_ph2", name: "Sunita", role: "PHARMACY_ADMIN", partnerId: "ph_2" };
const rider1: SessionUser = { id: "u_dp1", name: "Sonu", role: "DELIVERY_PARTNER", partnerId: "dp_1" };
const rider2: SessionUser = { id: "u_dp2", name: "Deepak", role: "DELIVERY_PARTNER", partnerId: "dp_2" };
const rider3: SessionUser = { id: "u_dp3", name: "Imran", role: "DELIVERY_PARTNER", partnerId: "dp_3" }; // offline
const rider4: SessionUser = { id: "u_dp4", name: "Vikas", role: "DELIVERY_PARTNER", partnerId: "dp_4" };
const admin: SessionUser = { id: "u_ad", name: "Admin", role: "SUPER_ADMIN" };

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0, 1, 2, 3]);
const rxFile = { name: "rx.png", type: "image/png", bytes: PNG };
const base = { pharmacyId: "ph_1", addressId: "ad_1", deliveryType: "NORMAL" as const, paymentMethod: "COD" as const };
const otc = (qty = 2) => createOrder(customer, { ...base, items: [{ medicineId: MED.PARACETAMOL, quantity: qty }] });
const stockOf = (ph: string, med: string) => db().inventory.filter((i) => i.pharmacyId === ph && i.medicineId === med).reduce((s, i) => s + i.stockQuantity, 0);
const availableOf = (ph: string, med: string) => db().inventory.filter((i) => i.pharmacyId === ph && i.medicineId === med).reduce((s, i) => s + availableQuantity(i), 0);
const pickup = (o: { id: string }) => codeFor(deliveryOf(db().orders.find((x) => x.id === o.id)!)!, "PICKUP");
const dcode = (o: { id: string }) => codeFor(deliveryOf(db().orders.find((x) => x.id === o.id)!)!, "DELIVERY");

/** Drives an order through pharmacy steps up to READY_FOR_PICKUP. */
function readyOrder(qty = 2) {
  const o = otc(qty);
  advanceAsPharmacy(pharmacist, o.id, "confirm");
  advanceAsPharmacy(pharmacist, o.id, "prepare");
  advanceAsPharmacy(pharmacist, o.id, "ready");
  return o;
}

beforeEach(() => resetDb());

describe("seed data", () => {
  it("matches the V1 brief", () => {
    const d = db();
    expect(d.medicines).toHaveLength(20);
    expect(d.pharmacies).toHaveLength(5);
    expect(d.serviceAreas).toHaveLength(3);
    expect(d.users.filter((u) => u.role === "CUSTOMER")).toHaveLength(5);
    expect(d.deliveryPartners).toHaveLength(5);
    expect(d.orders.length).toBeGreaterThanOrEqual(10);
    // every state-machine status is represented by a sample order
    const seen = new Set(d.orders.map((o) => o.status));
    for (const s of ["PENDING", "PRESCRIPTION_REVIEW", "CONFIRMED", "PREPARING", "READY_FOR_PICKUP", "RIDER_ASSIGNED", "OUT_FOR_DELIVERY", "DELIVERED", "CANCELLED"]) expect(seen.has(s as never)).toBe(true);
  });
});

describe("smart local medicine finder", () => {
  it("shows closest / fastest / cheapest across pharmacy-specific stock", () => {
    const [r] = searchMedicines({ q: "paracetamol 650", pincode: "261001" });
    expect(r.medicine.name).toBe("Paracetamol 650");
    expect(r.pharmacyCount).toBeGreaterThan(1);
    expect(r.closest!.km).toBeLessThanOrEqual(10);
    expect(r.lowest!.price).toBeLessThanOrEqual(r.medicine.mrp);
  });
  it("matches generic, brand and category; filters Rx / availability", () => {
    expect(searchMedicines({ q: "levothyroxine", pincode: "261001" })[0].medicine.name).toBe("Thyronorm 50");
    expect(searchMedicines({ q: "Dolo", pincode: "261001" })[0].medicine.brand).toBe("Dolo");
    expect(searchMedicines({ q: "thyroid", pincode: "261001" }).every((r) => r.medicine.category === "Thyroid")).toBe(true);
    expect(searchMedicines({ rx: "yes", pincode: "261001" }).every((r) => r.medicine.prescriptionRequired)).toBe(true);
    expect(searchMedicines({ availableNearby: true, pincode: "261001" }).every((r) => r.available)).toBe(true);
  });
  it("excludes unverified pharmacies and pincodes nobody serves", () => {
    expect(offersFor(MED.PARACETAMOL, "261001", pincodeCenter("261001")).some((o) => o.pharmacyId === "ph_5")).toBe(false);
    expect(offersFor(MED.PARACETAMOL, "999999", null)).toEqual([]);
  });
  it("availability is per pharmacy: stock at one shop does not make another show it", () => {
    const insulin = offersFor(MED.INSULIN, "261001", pincodeCenter("261001"));
    expect(insulin.map((o) => o.pharmacyId)).toEqual(["ph_1"]);
  });
  it("skips zero stock and expired batches, sums valid batches", () => {
    for (const i of db().inventory.filter((x) => x.pharmacyId === "ph_1" && x.medicineId === MED.PARACETAMOL)) i.stockQuantity = 0;
    expect(offersFor(MED.PARACETAMOL, "261001").some((o) => o.pharmacyId === "ph_1")).toBe(false);
    const inv = db().inventory.find((i) => i.pharmacyId === "ph_2" && i.medicineId === MED.PARACETAMOL)!;
    inv.expiry = new Date(Date.now() - 1000).toISOString();
    expect(offersFor(MED.PARACETAMOL, "261001").some((o) => o.pharmacyId === "ph_2")).toBe(false);
  });
});

describe("Find This Medicine For Me", () => {
  it("broadcasts, stores responses separately, and notifies when found", () => {
    const req = createMedicineRequest({ medicineQuery: "Rare tonic", mobile: "9876543210", pincode: "261001" }, customer.id);
    expect(req.pharmaciesNotified).toBeGreaterThan(0);
    respondToRequest(pharmacist, req.id, "NOT_AVAILABLE", { restockEta: "2 days" });
    expect(db().medicineRequests[0].status).toBe("SEARCHING");
    respondToRequest(pharmacist, req.id, "AVAILABLE", { price: 90, availableQty: 3, prepMinutes: 10 });
    expect(db().medicineRequests[0].status).toBe("FOUND");
    expect(db().medicineRequestResponses.filter((x) => x.requestId === req.id)).toHaveLength(1); // replaced, not duplicated
    expect(db().notifications.some((n) => n.event === "MEDICINE_FOUND" && n.userId === customer.id)).toBe(true);
    expect(myRequests(customer).find((r) => r.id === req.id)!.responses[0].pharmacyName).toBe("Shree Ram Medical Store");
  });
  it("refuses areas with no partner pharmacy", () => {
    expect(() => createMedicineRequest({ medicineQuery: "x y", mobile: "9876543210", pincode: "110001" })).toThrow(/coming to your area/);
  });
  it("only pharmacies serving the pincode may respond", () => {
    const req = createMedicineRequest({ medicineQuery: "Tonic", mobile: "9876543210", pincode: "261125" }, customer.id);
    expect(() => respondToRequest(pharmacist, req.id, "AVAILABLE", { price: 90, availableQty: 3, prepMinutes: 10 })).toThrow(); // ph_1 does not serve 261125
  });
  it("saying Available needs price, quantity and prep time", () => {
    const req = createMedicineRequest({ medicineQuery: "Rare tonic", mobile: "9876543210", pincode: "261001", strength: "200 ml", quantity: 2 }, customer.id);
    expect(() => respondToRequest(pharmacist, req.id, "AVAILABLE", {})).toThrow(/price/i);
    expect(() => respondToRequest(pharmacist, req.id, "AVAILABLE", { price: 90, availableQty: 2 })).toThrow(/prepare/i);
    expect(() => respondToRequest(pharmacist, req.id, "NOT_AVAILABLE", {})).not.toThrow();
  });
  it("lists who was asked and keeps strength and quantity", () => {
    const req = createMedicineRequest({ medicineQuery: "Rare tonic", mobile: "9876543210", pincode: "261001", strength: "200 ml", quantity: 2 }, customer.id);
    expect(req.asked.length).toBe(req.pharmaciesNotified);
    const mine = myRequests(customer).find((r) => r.id === req.id)!;
    expect(mine.quantity).toBe(2);
    expect(mine.strength).toBe("200 ml");
    expect(openRequestsForPharmacy(pharmacist).find((r) => r.id === req.id)).toMatchObject({ quantity: 2, strength: "200 ml", ageMinutes: expect.any(Number) });
  });
});

describe("prescription rules cannot be bypassed", () => {
  const rxItems = [{ medicineId: MED.METFORMIN, quantity: 2 }];
  it("refuses Rx medicines without a prescription, and someone else's prescription", () => {
    expect(() => createOrder(customer, { ...base, items: rxItems })).toThrow(/prescription is required/i);
    const other = storePrescription({ userId: "u_other", file: rxFile, requestedMedicines: [], source: "UPLOAD" });
    expect(() => createOrder(customer, { ...base, prescriptionId: other.id, items: rxItems })).toThrow(/not found/i);
  });
  it("blocks restricted medicines unless the prescription is already approved", () => {
    const rx = storePrescription({ userId: customer.id, file: rxFile, requestedMedicines: [], source: "UPLOAD" });
    expect(() => createOrder(customer, { ...base, prescriptionId: rx.id, items: [{ medicineId: MED.ALPRAZOLAM, quantity: 1 }] })).toThrow(/Restricted/);
    rx.status = "APPROVED";
    expect(createOrder(customer, { ...base, prescriptionId: rx.id, items: [{ medicineId: MED.ALPRAZOLAM, quantity: 1 }] }).status).toBe("PRESCRIPTION_REVIEW"); // still needs pharmacist review
  });
  it("Rx orders wait for review, cannot be confirmed early, and items are never changed", () => {
    const rx = storePrescription({ userId: customer.id, file: rxFile, requestedMedicines: ["Metformin 500"], source: "UPLOAD" });
    const o = createOrder(customer, { ...base, prescriptionId: rx.id, items: rxItems });
    expect(o.status).toBe("PRESCRIPTION_REVIEW");
    expect(() => advanceAsPharmacy(pharmacist, o.id, "confirm")).toThrow(/cannot go from/);
    reviewOrderPrescription(pharmacist, o.id, "APPROVE");
    expect(o.status).toBe("PRESCRIPTION_APPROVED");
    expect(rx.status).toBe("APPROVED");
    advanceAsPharmacy(pharmacist, o.id, "confirm");
    expect(o.status).toBe("CONFIRMED");
    expect(o.items.map((i) => i.medicineId)).toEqual([MED.METFORMIN]);
  });
  it("rejecting a prescription cancels the order and needs a reason", () => {
    const rx = storePrescription({ userId: customer.id, file: rxFile, requestedMedicines: [], source: "UPLOAD" });
    const o = createOrder(customer, { ...base, prescriptionId: rx.id, items: rxItems });
    expect(() => reviewOrderPrescription(pharmacist, o.id, "REJECT")).toThrow(/why/);
    reviewOrderPrescription(pharmacist, o.id, "REJECT", "Unreadable");
    expect(o.status).toBe("CANCELLED");
    expect(rx.status).toBe("REJECTED");
    expect(o.cancelledBy).toBe("PHARMACIST");
  });
  it("clarification keeps the order in review until a new prescription is attached", () => {
    const rx = storePrescription({ userId: customer.id, file: rxFile, requestedMedicines: [], source: "UPLOAD" });
    const o = createOrder(customer, { ...base, prescriptionId: rx.id, items: rxItems });
    reviewOrderPrescription(pharmacist, o.id, "CLARIFY", "Doctor's signature is cut off");
    expect(o.status).toBe("PRESCRIPTION_REVIEW");
    expect(rx.status).toBe("NEEDS_CLARIFICATION");
    const better = storePrescription({ userId: customer.id, file: rxFile, requestedMedicines: [], source: "UPLOAD" });
    attachPrescription(customer, o.id, better.id);
    expect(o.prescriptionId).toBe(better.id);
    expect(better.status).toBe("UNDER_REVIEW");
  });
  it("rejects non-image uploads even with a faked MIME type", () => {
    expect(() => storePrescription({ userId: customer.id, file: { name: "a.png", type: "image/png", bytes: new Uint8Array([0x4d, 0x5a, 0, 0]) }, requestedMedicines: [], source: "UPLOAD" })).toThrow(/does not match/);
  });
  it("saved-medicine reorder and repeat order never skip prescription review", () => {
    db().prescriptions.length = 0;
    expect(() => reorderSaved(customer, "sv_1", "ad_1", "COD")).toThrow(/upload a current prescription/i);
    const rx = storePrescription({ userId: customer.id, familyMemberId: "fm_2", file: rxFile, requestedMedicines: [], source: "UPLOAD" });
    rx.status = "APPROVED";
    const o = reorderSaved(customer, "sv_1", "ad_1", "COD");
    expect(o.status).toBe("PRESCRIPTION_REVIEW");
    expect(o.isRepeat).toBe(true);
    expect(() => repeatOrder(customer, "ord_1")).toThrow(/current prescription/i); // its original prescription was removed above
  });
  it("standalone review only for prescriptions without an active order", () => {
    // rx_2 belongs to an order under review: approving the prescription moves that order forward with it
    reviewPrescription(pharmacist, "rx_2", "APPROVE");
    expect(db().orders.find((o) => o.prescriptionId === "rx_2")!.status).toBe("PRESCRIPTION_APPROVED");
    expect(() => reviewPrescription(pharmacist, "rx_2", "APPROVE")).toThrow(); // second decision on the same file is refused
    const rx = reviewPrescription(pharmacist, "rx_3", "APPROVE");
    expect(rx.status).toBe("APPROVED");
    expect(prescriptionQueue(pharmacist).callbacks.some((c) => c.prescriptionId === "rx_3")).toBe(false);
  });
});

describe("order state machine end to end", () => {
  it("runs PENDING → … → DELIVERED with OTPs, COD collection and consumed stock", () => {
    const before = stockOf("ph_1", MED.PARACETAMOL);
    const o = otc(2);
    expect(o.status).toBe("PENDING");
    expect(stockOf("ph_1", MED.PARACETAMOL)).toBe(before); // nothing reserved until the pharmacy confirms
    advanceAsPharmacy(pharmacist, o.id, "confirm");
    expect(stockOf("ph_1", MED.PARACETAMOL)).toBe(before - 2);
    advanceAsPharmacy(pharmacist, o.id, "prepare");
    advanceAsPharmacy(pharmacist, o.id, "ready");
    expect(o.status).toBe("READY_FOR_PICKUP");

    acceptDelivery(rider1, o.id);
    expect(o.status).toBe("RIDER_ASSIGNED");
    expect(() => riderStep(rider1, o.id, "PICKUP", "0000")).toThrow(/Pickup code/);
    riderStep(rider1, o.id, "PICKUP", pickup(o));
    expect(o.status).toBe("PICKED_UP");
    riderStep(rider1, o.id, "START");
    expect(o.status).toBe("OUT_FOR_DELIVERY");
    expect(() => riderStep(rider1, o.id, "DELIVER", "0000")).toThrow(/Delivery code/);
    riderStep(rider1, o.id, "DELIVER", dcode(o));
    expect(o.status).toBe("DELIVERED");
    expect(o.paymentStatus).toBe("PAID");
    expect(stockOf("ph_1", MED.PARACETAMOL)).toBe(before - 2);
    expect(o.statusHistory.map((h) => h.status)).toEqual(["PENDING", "CONFIRMED", "PREPARING", "READY_FOR_PICKUP", "RIDER_ASSIGNED", "PICKED_UP", "OUT_FOR_DELIVERY", "DELIVERED"]);
  });

  it("refuses illegal jumps", () => {
    const o = otc();
    expect(() => advanceAsPharmacy(pharmacist, o.id, "ready")).toThrow(/cannot go from/);
    expect(() => advanceAsPharmacy(pharmacist, o.id, "prepare")).toThrow(/cannot go from/);
    advanceAsPharmacy(pharmacist, o.id, "confirm");
    expect(() => advanceAsPharmacy(pharmacist, o.id, "confirm")).toThrow(/cannot go from/);
    expect(() => acceptDelivery(rider1, o.id)).toThrow(/taken|just/);
    expect(() => riderStep(rider1, o.id, "PICKUP", pickup(o))).toThrow(); // not their order
  });

  it("customer can cancel until pickup; stock returns and paid orders are refunded", () => {
    const before = stockOf("ph_1", MED.PARACETAMOL);
    const o = createOrder(customer, { ...base, paymentMethod: "UPI", items: [{ medicineId: MED.PARACETAMOL, quantity: 2 }] });
    confirmPayment(customer, o.id, "demo_1");
    advanceAsPharmacy(pharmacist, o.id, "confirm");
    expect(stockOf("ph_1", MED.PARACETAMOL)).toBe(before - 2);
    cancelOrder(customer, o.id, "Changed my mind");
    expect(o.status).toBe("CANCELLED");
    expect(o.paymentStatus).toBe("REFUNDED");
    expect(stockOf("ph_1", MED.PARACETAMOL)).toBe(before);
    expect(() => cancelOrder(customer, o.id, "again")).toThrow(/closed/);
  });

  it("blocks customer cancellation once the rider has picked up", () => {
    const o = readyOrder();
    acceptDelivery(rider1, o.id);
    riderStep(rider1, o.id, "PICKUP", pickup(o));
    expect(() => cancelOrder(customer, o.id, "late")).toThrow(/on its way/);
  });

  it("cancelling after a rider accepted releases the rider", () => {
    const o = readyOrder();
    acceptDelivery(rider1, o.id);
    cancelOrder(customer, o.id, "Not needed");
    expect(o.deliveryPartnerId).toBeUndefined();
    expect(db().deliveries.find((x) => x.orderId === o.id)!.status).toBe("FAILED");
    expect(riderSummary(rider1).activeJobs).toBe(1); // only the seeded job remains
  });

  it("pharmacy rejection needs a reason and notifies the customer", () => {
    const o = otc();
    expect(() => rejectOrder(pharmacist, o.id, " ")).toThrow();
    rejectOrder(pharmacist, o.id, "Out of stock today");
    expect(o.status).toBe("CANCELLED");
    expect(db().notifications.some((n) => n.event === "ORDER_CANCELLED" && n.userId === customer.id)).toBe(true);
  });

  it("another pharmacy cannot touch the order", () => {
    const o = otc();
    expect(() => advanceAsPharmacy(owner2, o.id, "confirm")).toThrow();
    expect(() => rejectOrder(owner2, o.id, "nope nope")).toThrow();
    expect(() => getOrderFor({ id: "u_2", name: "x", role: "CUSTOMER" }, o.id)).toThrow();
  });

  it("validates stock, coverage and priority availability at checkout", () => {
    expect(() => createOrder(customer, { ...base, items: [{ medicineId: MED.PARACETAMOL, quantity: 9999 }] })).toThrow(/not available in the quantity/);
    expect(() => createOrder(customer, { ...base, pharmacyId: "ph_3", addressId: "ad_2", items: [{ medicineId: MED.PARACETAMOL, quantity: 1 }] })).toThrow(/does not deliver/);
    expect(() => createOrder(customer, { ...base, pharmacyId: "ph_3", deliveryType: "PRIORITY", items: [{ medicineId: MED.METFORMIN, quantity: 1 }] })).toThrow(/Priority/);
  });

  it("two customers cannot both reserve the last units", () => {
    for (const i of db().inventory.filter((x) => x.pharmacyId === "ph_1" && x.medicineId === MED.IBUPROFEN)) i.stockQuantity = i === db().inventory.find((x) => x.pharmacyId === "ph_1" && x.medicineId === MED.IBUPROFEN) ? 2 : 0;
    const a = createOrder(customer, { ...base, items: [{ medicineId: MED.IBUPROFEN, quantity: 2 }] });
    // The units are promised at checkout, so the second customer is stopped immediately, not at confirmation.
    expect(availableOf("ph_1", MED.IBUPROFEN)).toBe(0);
    expect(() => createOrder({ id: "u_2", name: "R", role: "CUSTOMER" }, { ...base, addressId: "ad_3", items: [{ medicineId: MED.IBUPROFEN, quantity: 2 }] })).toThrow(/not available in the quantity/);
    expect(db().orders.filter((o) => o.items.some((i) => i.medicineId === MED.IBUPROFEN) && o.status === "PENDING")).toHaveLength(1);
    expect(a.stockState).toBe("RESERVED");
  });

  it("prices: delivery fees, offers and admin-configurable settings", () => {
    const o = createOrder(customer, { ...base, deliveryType: "PRIORITY", offerCode: "first10", items: [{ medicineId: MED.PARACETAMOL, quantity: 8 }] });
    expect(o.deliveryFee).toBe(settings().priorityDeliveryFee);
    expect(o.discount).toBeGreaterThan(0);
    expect(o.total).toBe(o.subtotal + o.deliveryFee - o.discount);
    updatePlatformSettings(admin, { priorityDeliveryFee: 99 });
    expect(quoteOrder(customer, { pharmacyId: "ph_1", addressId: "ad_1", items: [{ medicineId: MED.PARACETAMOL, quantity: 1 }] }).priority!.fee).toBe(99);
  });

  it("payment goes through the provider layer (COD due → paid on delivery; UPI pending → paid)", () => {
    const cod = otc();
    expect(cod.paymentStatus).toBe("PENDING");
    const upi = createOrder(customer, { ...base, paymentMethod: "UPI", items: [{ medicineId: MED.PARACETAMOL, quantity: 1 }] });
    expect(upi.paymentStatus).toBe("PENDING");
    expect(() => confirmPayment(customer, cod.id, "x_123")).toThrow(/Cash on Delivery/);
    expect(confirmPayment(customer, upi.id, "demo_ref_1").paymentStatus).toBe("PAID");
    expect(db().payments.find((p) => p.orderId === upi.id)!.provider).toBe("MOCK");
  });
});

describe("rider workflow and privacy", () => {
  it("lists available deliveries without customer identity, and hides medicines", () => {
    const o = readyOrder();
    const list = availableDeliveries(rider4);
    const job = list.find((j) => j.id === o.id)!;
    expect(job).toBeTruthy();
    const json = JSON.stringify(job);
    expect(json).not.toMatch(/Asha|9876543210|Hanuman|Paracetamol|prescription/i);
    expect(job.dropArea).toMatch(/261001/);
    expect(job.collectCash).toBe(o.total);
    // seeded ready order at ph_2 is also in the pool
    expect(list.some((j) => j.code === "MC-51915")).toBe(true);
  });

  it("after accepting, the rider sees the address but still no medical information", () => {
    const o = readyOrder();
    acceptDelivery(rider4, o.id);
    const [job] = activeDeliveries(rider4);
    expect(job.customer.name).toBe("Asha Verma");
    expect(job.customer.landmark).toMatch(/Hanuman/);
    expect(JSON.stringify(job)).not.toMatch(/Paracetamol|prescription|Penicillin|allerg/i);
  });

  it("first rider wins; offline riders and unverified riders cannot accept", () => {
    const o = readyOrder();
    expect(() => acceptDelivery(rider3, o.id)).toThrow(/online/);
    acceptDelivery(rider4, o.id);
    expect(() => acceptDelivery(rider2, o.id)).toThrow(/just taken/);
    expect(availableDeliveries(rider2).some((j) => j.id === o.id)).toBe(false);
    expect(() => setAvailability({ id: "u_dp5", name: "A", role: "DELIVERY_PARTNER", partnerId: "dp_5" }, true)).toThrow(/verification/);
  });

  it("limits a rider to three active deliveries", () => {
    const a = readyOrder(); const b = readyOrder(); const c = readyOrder();
    acceptDelivery(rider4, a.id); acceptDelivery(rider4, b.id); acceptDelivery(rider4, c.id);
    const d4 = readyOrder();
    expect(() => acceptDelivery(rider4, d4.id)).toThrow(/3 active/);
  });

  it("a rider can drop a job before pickup and it returns to the pool", () => {
    const o = readyOrder();
    acceptDelivery(rider4, o.id);
    riderStep(rider4, o.id, "DROP");
    expect(o.status).toBe("READY_FOR_PICKUP");
    expect(availableDeliveries(rider2).some((j) => j.id === o.id)).toBe(true);
  });

  it("cannot go offline while carrying a delivery", () => {
    expect(() => setAvailability(rider1, false)).toThrow(/active deliveries/);
  });

  it("records history and earnings", () => {
    const o = readyOrder();
    acceptDelivery(rider4, o.id);
    riderStep(rider4, o.id, "PICKUP", pickup(o));
    riderStep(rider4, o.id, "START");
    riderStep(rider4, o.id, "DELIVER", dcode(o));
    expect(deliveryHistory(rider4)[0]).toMatchObject({ orderCode: o.code, payout: settings().riderPayoutNormal });
    const e = earningsSummary(rider4);
    expect(e.today).toEqual({ amount: settings().riderPayoutNormal, count: 1 });
    expect(e.cashCollectedToday).toBe(o.total);
    expect(e.days).toHaveLength(7);
  });

  it("pharmacy can assign a specific or the nearest available rider", () => {
    const o = readyOrder();
    assignRider(owner, o.id, "dp_2");
    expect(o.deliveryPartnerId).toBe("dp_2");
    const p = readyOrder();
    assignRider(pharmacist, p.id);
    expect(["dp_1", "dp_2", "dp_4"]).toContain(p.deliveryPartnerId);
    const q = readyOrder();
    expect(() => assignRider(pharmacist, q.id, "dp_3")).toThrow(/available/); // offline rider
  });

  it("OTPs are shown only to the right party at the right time", () => {
    const o = readyOrder();
    expect(userSafeOrder(o, customer).deliveryOtp).toBeUndefined();
    expect(userSafeOrder(o, pharmacist).pickupOtp).toBe(pickup(o));
    expect(userSafeOrder(o, customer).pickupOtp).toBeUndefined();
    acceptDelivery(rider4, o.id);
    expect(userSafeOrder(o, customer).deliveryOtp).toBe(dcode(o));
    expect(userSafeOrder(o, pharmacist).deliveryOtp).toBeUndefined();
    expect(pharmacyOrderView(o).rider?.name).toBe("Vikas Pal");
  });
});

describe("pharmacy portal data", () => {
  it("only lets a pharmacy edit its own stock; same batch updates instead of duplicating", () => {
    const other = db().inventory.find((i) => i.pharmacyId === "ph_2")!;
    expect(() => quickStockUpdate(owner, other.id, 5)).toThrow();
    const row = db().inventory.find((i) => i.pharmacyId === "ph_1")!;
    const n = db().inventory.length;
    upsertInventory(owner, { medicineId: row.medicineId, batch: row.batch, expiry: row.expiry, mrp: row.mrp, sellingPrice: row.sellingPrice, stockQuantity: 7, lowStockThreshold: 3 });
    expect(db().inventory).toHaveLength(n);
    expect(row.stockQuantity).toBe(7);
  });
  it("queue, customers (masked phones), payments and reports reflect real orders", () => {
    const q = prescriptionQueue(pharmacist);
    expect(q.orders.map((o) => o.code)).toContain("MC-51921");
    expect(q.callbacks[0].callbackMobile).toBe("9811122233");
    const customers = customersOf(pharmacist);
    expect(customers.length).toBeGreaterThan(2);
    expect(customers.every((c) => /••/.test(c.mobile))).toBe(true);
    const pay = paymentsOf(owner);
    expect(pay.totals.paid).toBeGreaterThan(0);
    expect(pay.payments.every((p) => p.orderCode)).toBe(true);
    const rep = reportsOf(pharmacist);
    expect(rep.days).toHaveLength(7);
    expect(rep.totals.cancelled).toBe(1);
    expect(rep.topMedicines.length).toBeGreaterThan(0);
  });
});

describe("saved medicines, repeat orders, cart, reminders", () => {
  it("one-click repeat reuses items, pharmacy, address and goes through review for Rx", () => {
    const o = repeatOrder(customer, "ord_1");
    expect(o.isRepeat).toBe(true);
    expect(o.pharmacyId).toBe("ph_1");
    expect(o.status).toBe("PRESCRIPTION_REVIEW");
    const t = repeatOrder(customer, "ord_2");
    expect(t.status).toBe("PENDING");
    expect(t.deliveryType).toBe("PRIORITY");
  });
  it("cannot repeat someone else's order", () => {
    expect(() => repeatOrder({ id: "u_2", name: "x", role: "CUSTOMER" }, "ord_1")).toThrow();
  });
  it("saves a delivered order as a refill-ready list and sends due reminders once a day", () => {
    const s = saveFromOrder(customer, "ord_1", 30);
    expect(s.items).toHaveLength(2);
    expect(Date.parse(s.nextRefillAt)).toBeGreaterThan(Date.now());
    expect(sendDueRefillReminders()).toBe(0); // nothing is due within 3 days yet
    db().savedMedicines.find((x) => x.id === "sv_1")!.nextRefillAt = new Date(Date.now() + 86400_000).toISOString();
    expect(sendDueRefillReminders()).toBe(1);
    expect(sendDueRefillReminders()).toBe(0); // once per day
    expect(db().notifications.some((n) => n.event === "REFILL_REMINDER")).toBe(true);
  });
  it("persists the cart per customer and re-prices from inventory", () => {
    saveCart(customer, { pharmacyId: "ph_1", items: [{ medicineId: MED.PARACETAMOL, quantity: 3 }] });
    const c = getCart(customer);
    expect(c.pharmacyName).toBe("Shree Ram Medical Store");
    expect(c.lines[0]).toMatchObject({ medicineId: MED.PARACETAMOL, quantity: 3 });
    expect(c.lines[0].price).toBeLessThanOrEqual(c.lines[0].mrp);
    const o = otc();
    expect(o.id).toBeTruthy();
    expect(getCart(customer).lines).toHaveLength(0); // placing an order clears the cart
  });
});

describe("admin", () => {
  it("coverage, launch signups and verification (audit logged, reason required)", () => {
    expect(coverageFor("261001").available).toBe(true);
    expect(coverageFor("110001").available).toBe(false);
    launchSignup("9000000009", "110001");
    expect(db().serviceAreaInterests.some((i) => i.pincode === "110001" && i.mobile === "9000000009")).toBe(true);
    expect(db().serviceAreas.find((a) => a.pincode === "110001")!.status).toBe("COMING_SOON");
    expect(() => setVerification(admin, "pharmacies", "ph_5", "REJECTED")).toThrow(/reason/);
    setVerification(admin, "pharmacies", "ph_5", "VERIFIED");
    expect(db().pharmacies.find((p) => p.id === "ph_5")!.acceptingOrders).toBe(true);
    setVerification(admin, "pharmacies", "ph_5", "SUSPENDED", "Licence expired");
    expect(db().pharmacies.find((p) => p.id === "ph_5")!.acceptingOrders).toBe(false);
    expect(db().audit[0].action).toBe("VERIFICATION_SUSPENDED");
  });
  it("settlements: generated once per delivered order with commission, then progress forward only", () => {
    const o = readyOrder(); acceptDelivery(rider4, o.id);
    riderStep(rider4, o.id, "PICKUP", pickup(o)); riderStep(rider4, o.id, "START"); riderStep(rider4, o.id, "DELIVER", dcode(o));
    const created = generateSettlements(admin);
    const s = created.find((x) => x.partnerId === "ph_1")!;
    expect(s.orderCount).toBeGreaterThanOrEqual(1);
    expect(s.commission).toBe(Math.round((s.gross * settings().commissionPercent) / 100));
    expect(s.net).toBe(s.gross - s.commission);
    expect(o.settlementId).toBe(s.id);
    expect(generateSettlements(admin).filter((x) => x.partnerId === "ph_1")).toHaveLength(0);
    setSettlementStatus(admin, s.id, "PROCESSING");
    setSettlementStatus(admin, s.id, "PAID");
    expect(() => setSettlementStatus(admin, s.id, "PENDING")).toThrow(/backwards/);
  });
  it("tables never leak OTPs, file keys or prescription contents", () => {
    const json = JSON.stringify([adminList("orders"), adminList("customers"), adminList("requests"), adminList("complaints")]);
    expect(json).not.toMatch(/deliveryOtp|pickupOtp|fileKey|passwordHash/);
    otc(); // an order placed right now always counts as "today" (seeded orders can fall on yesterday just after midnight)
    expect(adminStats().ordersToday).toBeGreaterThan(0);
    expect(platformReports().days).toHaveLength(7);
  });
});

describe("admin attention list", () => {
  it("flags an order nobody answered, most urgent first", () => {
    const o = createOrder(customer, { ...base, items: [{ medicineId: MED.PARACETAMOL, quantity: 1 }] });
    expect(attentionItems().some((a) => a.id === "stuck-pending")).toBe(false); // a fresh order is fine
    db().orders.find((x) => x.id === o.id)!.createdAt = new Date(Date.now() - 90 * 60_000).toISOString();
    expect(attentionItems()[0]).toMatchObject({ id: "stuck-pending", severity: "critical" });
    expect(adminStats().attention.length).toBeGreaterThan(0);
  });
});

describe("inventory freshness", () => {
  it("stamps updatedAt when stock changes", () => {
    const row = db().inventory.find((i) => i.pharmacyId === "ph_1")!;
    row.lastUpdatedAt = "2020-01-01T00:00:00.000Z";
    quickStockUpdate(pharmacist, row.id, row.stockQuantity + 1);
    expect(Date.parse(row.lastUpdatedAt)).toBeGreaterThan(Date.parse("2021-01-01"));
  });
});
