import { isFinal } from "@/lib/order-machine";
import { availableQuantity, type ExpiryState, type Pharmacy, type PharmacyInventory, type SessionUser } from "@/lib/types";
import { stockConfidence } from "../catalog/confidence";
import { badRequest, conflict, forbidden, notFound } from "@/server/errors";
import { audit, db, uid } from "@/server/store";
import { track } from "@/server/analytics";

/**
 * The caller's pharmacy. This is the gate for EVERY pharmacy action (orders, stock, requests, reports):
 * an applicant has no pharmacy yet, and a pharmacy that is not VERIFIED (pending, rejected, suspended) cannot sell.
 */
export function pharmacyOf(user: SessionUser): Pharmacy {
  const p = db().pharmacies.find((x) => x.id === user.partnerId);
  if (!p) throw forbidden("Your pharmacy is not approved yet");
  if (p.verification !== "VERIFIED") throw forbidden("Your pharmacy is not active. Please contact support.");
  return p;
}

/** The pharmacy as its own staff see it: the settlement account number is masked. */
export function pharmacySettingsView(p: Pharmacy) {
  const s = p.onboarding?.settlement;
  return { ...p, onboarding: p.onboarding && { ...p.onboarding, settlement: s && { holderName: s.holderName, upiId: s.upiId, ifsc: s.ifsc, accountLast4: s.accountNumber?.slice(-4), savedAt: s.savedAt } } };
}

const startOfDay = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); };
const mask = (m: string) => `${m.slice(0, 2)}••••••${m.slice(-2)}`;

// ───────────── Inventory ─────────────

const DAY = 86400_000;

/** EXPIRED stock is never sold but is kept (history, returns, audits). 30 / 90 day windows drive the alerts. */
export function expiryStateOf(expiry: string, now = Date.now()): ExpiryState {
  const left = Date.parse(expiry) - now;
  return left <= 0 ? "EXPIRED" : left <= 30 * DAY ? "EXPIRING_30" : left <= 90 * DAY ? "EXPIRING_90" : "OK";
}

export function listInventory(user: SessionUser) {
  const p = pharmacyOf(user);
  const d = db();
  const now = Date.now();
  return d.inventory
    .filter((i) => i.pharmacyId === p.id)
    .map((i) => {
      const m = d.medicines.find((x) => x.id === i.medicineId)!;
      const expiryState = expiryStateOf(i.expiry, now);
      return {
        ...i, status: i.status ?? "ACTIVE", name: m.name, brand: m.brand, generic: m.genericName, manufacturer: m.manufacturer, strength: m.strength, availableQuantity: availableQuantity(i),
        low: i.stockQuantity <= i.lowStockThreshold, outOfStock: availableQuantity(i) === 0, expiryState, expiringSoon: expiryState === "EXPIRING_30" || expiryState === "EXPIRING_90",
        expired: expiryState === "EXPIRED", daysToExpiry: Math.floor((Date.parse(i.expiry) - now) / DAY),
        confidence: stockConfidence(i.lastUpdatedAt, now),
        /** Can a customer buy this line right now? */
        sellable: (i.status ?? "ACTIVE") === "ACTIVE" && expiryState !== "EXPIRED" && availableQuantity(i) > 0,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

type InventoryInput = Omit<PharmacyInventory, "id" | "pharmacyId" | "lastUpdatedAt" | "reservedQuantity" | "createdAt" | "updatedAt" | "updatedBy">;

/** The rules every inventory write must pass, in one place. */
function assertValidStock(input: InventoryInput, reserved: number) {
  if (!Number.isInteger(input.stockQuantity) || input.stockQuantity < 0) throw badRequest("Stock cannot be negative", { stockQuantity: "Stock cannot be negative" });
  if (input.stockQuantity < reserved) throw conflict(`${reserved} units are promised to open orders. Stock cannot go below that.`);
  if (input.sellingPrice > input.mrp) throw badRequest("Selling price cannot be higher than MRP", { sellingPrice: "Selling price cannot be higher than MRP" });
  if (input.mrp <= 0 || input.sellingPrice <= 0) throw badRequest("Prices must be more than zero");
}

export function upsertInventory(user: SessionUser, input: InventoryInput, id?: string) {
  return writeInventoryRow(user, pharmacyOf(user), input, id);
}

/**
 * The one place inventory rows are created or edited (manual entry, CSV import, admin match review all end here).
 * `actor` may be pharmacy staff or an admin acting on a pharmacy's behalf; the pharmacy is passed in already authorised.
 */
export function writeInventoryRow(user: Pick<SessionUser, "id" | "role">, p: Pharmacy, input: InventoryInput, id?: string) {
  const d = db();
  const med = d.medicines.find((m) => m.id === input.medicineId);
  if (!med) throw badRequest("Unknown medicine");
  if (med.status !== "ACTIVE") throw badRequest("This medicine is not in the catalogue any more");
  const now = new Date().toISOString();
  const row = id ? d.inventory.find((i) => i.id === id) : d.inventory.find((i) => i.pharmacyId === p.id && i.medicineId === input.medicineId && i.batch === input.batch);
  if (id && !row) throw notFound();
  if (row) {
    if (row.pharmacyId !== p.id) throw forbidden();
    assertValidStock(input, row.reservedQuantity);
    const before = { stock: row.stockQuantity, price: row.sellingPrice };
    Object.assign(row, input, { status: input.status ?? row.status ?? "ACTIVE", lastUpdatedAt: now, updatedAt: now, updatedBy: user.id });
    audit(user, "INVENTORY_EDITED", "Inventory", row.id, { from: before, stockQuantity: row.stockQuantity, sellingPrice: row.sellingPrice });
    return row;
  }
  assertValidStock(input, 0);
  const created: PharmacyInventory = { id: uid("inv"), pharmacyId: p.id, ...input, status: input.status ?? "ACTIVE", reservedQuantity: 0, lastUpdatedAt: now, createdAt: now, updatedAt: now, updatedBy: user.id };
  d.inventory.push(created);
  track("inventory_added", { userId: user.id }, { via: "manual" });
  audit(user, "INVENTORY_ADDED", "Inventory", created.id, { medicineId: created.medicineId, stockQuantity: created.stockQuantity });
  return created;
}

function ownRow(user: SessionUser, id: string): PharmacyInventory {
  const p = pharmacyOf(user);
  const row = db().inventory.find((i) => i.id === id);
  if (!row) throw notFound();
  if (row.pharmacyId !== p.id) throw forbidden();
  return row;
}

/** Sets the shelf count (exact entry). It can never go below the units already promised to open orders, and never below zero. */
export function quickStockUpdate(user: SessionUser, id: string, stockQuantity: number) {
  const row = ownRow(user, id);
  if (!Number.isInteger(stockQuantity) || stockQuantity < 0 || stockQuantity > 100000) throw badRequest("Enter a valid quantity");
  if (stockQuantity < row.reservedQuantity) throw conflict(`${row.reservedQuantity} units are promised to open orders. Stock cannot go below that.`);
  const before = row.stockQuantity;
  const now = new Date().toISOString();
  row.stockQuantity = stockQuantity;
  row.lastUpdatedAt = now; row.updatedAt = now; row.updatedBy = user.id;
  audit(user, "STOCK_UPDATED", "Inventory", row.id, { from: before, to: stockQuantity, low: stockQuantity <= row.lowStockThreshold });
  return row;
}

/** + / − buttons: change the count by a small amount. Same rules as an exact entry. */
export function adjustStock(user: SessionUser, id: string, delta: number) {
  const row = ownRow(user, id);
  if (!Number.isInteger(delta) || Math.abs(delta) > 10000) throw badRequest("Enter a whole number");
  return quickStockUpdate(user, id, row.stockQuantity + delta);
}

export function setInventoryStatus(user: SessionUser, id: string, status: "ACTIVE" | "INACTIVE") {
  const row = ownRow(user, id);
  row.status = status;
  const now = new Date().toISOString();
  row.lastUpdatedAt = now; row.updatedAt = now; row.updatedBy = user.id;
  audit(user, status === "ACTIVE" ? "INVENTORY_ACTIVATED" : "INVENTORY_DEACTIVATED", "Inventory", row.id);
  return row;
}

// ───────────── Dashboard, queues and finance ─────────────

export function pharmacyStats(user: SessionUser) {
  const p = pharmacyOf(user);
  const d = db();
  const orders = d.orders.filter((o) => o.pharmacyId === p.id);
  const delivered = orders.filter((o) => o.status === "DELIVERED");
  const today = delivered.filter((o) => Date.parse(o.statusHistory.at(-1)?.at ?? o.createdAt) >= startOfDay());
  const sum = (xs: typeof orders) => xs.reduce((s, o) => s + o.total, 0);
  return {
    pharmacy: p,
    toReview: orders.filter((o) => o.status === "PRESCRIPTION_REVIEW").length,
    readyForPickup: orders.filter((o) => o.status === "READY_FOR_PICKUP" || o.status === "RIDER_ASSIGNED").length,
    newOrders: orders.filter((o) => ["PENDING", "PRESCRIPTION_APPROVED"].includes(o.status)).length,
    inProgress: orders.filter((o) => ["CONFIRMED", "PREPARING", "READY_FOR_PICKUP", "RIDER_ASSIGNED", "PICKED_UP", "OUT_FOR_DELIVERY"].includes(o.status)).length,
    deliveredToday: today.length,
    revenueToday: sum(today),
    revenueTotal: sum(delivered),
    lowStock: d.inventory.filter((i) => i.pharmacyId === p.id && (i.status ?? "ACTIVE") === "ACTIVE" && expiryStateOf(i.expiry) !== "EXPIRED" && i.stockQuantity <= i.lowStockThreshold).length,
    expired: d.inventory.filter((i) => i.pharmacyId === p.id && expiryStateOf(i.expiry) === "EXPIRED" && i.stockQuantity > 0).length,
    expiring30: d.inventory.filter((i) => i.pharmacyId === p.id && expiryStateOf(i.expiry) === "EXPIRING_30" && i.stockQuantity > 0).length,
    expiring90: d.inventory.filter((i) => i.pharmacyId === p.id && ["EXPIRING_30", "EXPIRING_90"].includes(expiryStateOf(i.expiry)) && i.stockQuantity > 0).length,
    outOfStock: d.inventory.filter((i) => i.pharmacyId === p.id && (i.status ?? "ACTIVE") === "ACTIVE" && expiryStateOf(i.expiry) !== "EXPIRED" && availableQuantity(i) === 0).length,
    openRequests: d.medicineRequests.filter((r) => r.status === "SEARCHING" && p.servicePincodes.includes(r.pincode) && !d.medicineRequestResponses.some((x) => x.requestId === r.id && x.pharmacyId === p.id)).length,
  };
}

/** Orders waiting for prescription review, plus "Call Me" prescriptions nobody has claimed. */
export function prescriptionQueue(user: SessionUser) {
  const p = pharmacyOf(user);
  const d = db();
  const orders = d.orders.filter((o) => o.pharmacyId === p.id && o.status === "PRESCRIPTION_REVIEW").map((o) => {
    const rx = d.prescriptions.find((x) => x.id === o.prescriptionId)!;
    const fm = d.familyMembers.find((f) => f.id === o.familyMemberId);
    return {
      kind: "ORDER" as const, orderId: o.id, code: o.code, createdAt: o.createdAt,
      patient: fm ? { name: fm.name, age: fm.age, allergies: fm.allergies } : { name: d.users.find((u) => u.id === o.userId)?.name ?? "Customer" },
      items: o.items.map((i) => ({ name: i.name, strength: i.strength, quantity: i.quantity, prescriptionRequired: i.prescriptionRequired })),
      prescription: { id: rx.id, status: rx.status, note: rx.reviewNote, requested: rx.requestedMedicines },
    };
  });
  const callbacks = d.prescriptions.filter((rx) => rx.source === "QUICK_ORDER" && ["UPLOADED", "NEEDS_CLARIFICATION"].includes(rx.status) && (!rx.pharmacyId || rx.pharmacyId === p.id)
    && !d.orders.some((o) => o.prescriptionId === rx.id)).map((rx) => ({
    kind: "CALLBACK" as const, prescriptionId: rx.id, createdAt: rx.createdAt, callbackMobile: rx.callbackMobile, status: rx.status,
  }));
  return { orders, callbacks };
}

/** Customers who ordered here. Pharmacies see names and order history with them; phone numbers are masked. */
export function customersOf(user: SessionUser) {
  const p = pharmacyOf(user);
  const d = db();
  const byUser = new Map<string, typeof d.orders>();
  for (const o of d.orders.filter((x) => x.pharmacyId === p.id)) byUser.set(o.userId, [...(byUser.get(o.userId) ?? []), o]);
  return [...byUser.entries()].map(([userId, orders]) => {
    const u = d.users.find((x) => x.id === userId);
    const done = orders.filter((o) => o.status === "DELIVERED");
    const sorted = [...orders].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return {
      id: userId, name: u?.name ?? "Customer", mobile: mask(u?.mobile ?? "0000000000"), area: sorted[0].addressSnapshot.area,
      orders: orders.length, delivered: done.length, spent: done.reduce((s, o) => s + o.total, 0), lastOrderAt: sorted[0].createdAt,
      repeatCustomer: done.length >= 2,
    };
  }).sort((a, b) => b.lastOrderAt.localeCompare(a.lastOrderAt));
}

export function paymentsOf(user: SessionUser) {
  const p = pharmacyOf(user);
  const d = db();
  const orders = d.orders.filter((o) => o.pharmacyId === p.id);
  const ids = new Set(orders.map((o) => o.id));
  const rows = d.payments.filter((x) => ids.has(x.orderId)).map((x) => ({ ...x, orderCode: orders.find((o) => o.id === x.orderId)!.code })).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const sum = (s: string) => rows.filter((r) => r.status === s).reduce((t, r) => t + r.amount, 0);
  return {
    totals: { paid: sum("PAID"), codDue: rows.filter((r) => r.method === "COD" && r.status === "PENDING").reduce((t, r) => t + r.amount, 0), pendingOnline: rows.filter((r) => r.method !== "COD" && r.status === "PENDING").reduce((t, r) => t + r.amount, 0), refunded: sum("REFUNDED") },
    payments: rows,
    settlements: d.settlements.filter((s) => s.partnerType === "PHARMACY" && s.partnerId === p.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
  };
}

/** Simple sales reporting for the last 7 days plus top medicines and order outcomes. */
export function reportsOf(user: SessionUser) {
  const p = pharmacyOf(user);
  const d = db();
  const orders = d.orders.filter((o) => o.pharmacyId === p.id);
  const days = Array.from({ length: 7 }, (_, i) => {
    const day = new Date(); day.setHours(0, 0, 0, 0); day.setDate(day.getDate() - (6 - i));
    const end = day.getTime() + 86400_000;
    const xs = orders.filter((o) => o.status === "DELIVERED" && Date.parse(o.createdAt) >= day.getTime() && Date.parse(o.createdAt) < end);
    return { label: day.toLocaleDateString("en-IN", { weekday: "short" }), orders: xs.length, revenue: xs.reduce((s, o) => s + o.total, 0) };
  });
  const top = new Map<string, { name: string; qty: number; revenue: number }>();
  for (const o of orders.filter((x) => x.status === "DELIVERED")) for (const i of o.items) {
    const t = top.get(i.medicineId) ?? { name: i.name, qty: 0, revenue: 0 };
    t.qty += i.quantity; t.revenue += i.unitPrice * i.quantity; top.set(i.medicineId, t);
  }
  const closed = orders.filter((o) => isFinal(o.status));
  const cancelled = closed.filter((o) => o.status === "CANCELLED");
  return {
    days,
    topMedicines: [...top.values()].sort((a, b) => b.revenue - a.revenue).slice(0, 5),
    totals: { orders: orders.length, delivered: closed.length - cancelled.length, cancelled: cancelled.length, cancelRate: closed.length ? Math.round((cancelled.length / closed.length) * 100) : 0 },
    rxShare: orders.length ? Math.round((orders.filter((o) => o.items.some((i) => i.prescriptionRequired)).length / orders.length) * 100) : 0,
    repeatShare: orders.length ? Math.round((orders.filter((o) => o.isRepeat).length / orders.length) * 100) : 0,
  };
}

export function updatePharmacySettings(user: SessionUser, patch: Partial<Pick<Pharmacy, "openTime" | "closeTime" | "servicePincodes" | "deliveryRadiusKm" | "priorityDelivery" | "acceptingOrders">>) {
  const p = pharmacyOf(user);
  if (user.role !== "PHARMACY_ADMIN") throw forbidden("Only the pharmacy owner can change store settings");
  if (patch.acceptingOrders && p.verification !== "VERIFIED") throw forbidden("Your pharmacy must be verified before it can accept orders");
  if (patch.acceptingOrders && !db().inventory.some((i) => i.pharmacyId === p.id && i.stockQuantity > 0)) throw conflict("Add your medicines first, then you can start accepting orders");
  Object.assign(p, patch);
  audit(user, "PHARMACY_SETTINGS_UPDATED", "Pharmacy", p.id, patch as Record<string, unknown>);
  return p;
}
