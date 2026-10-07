import { inventoryItemSchema, parseCsv } from "@/lib/validation";
import { isFinal } from "@/lib/order-machine";
import type { Pharmacy, PharmacyInventory, SessionUser } from "@/lib/types";
import { badRequest, forbidden, notFound } from "../errors";
import { audit, db, uid } from "../store";

export function pharmacyOf(user: SessionUser): Pharmacy {
  const p = db().pharmacies.find((x) => x.id === user.partnerId);
  if (!p) throw forbidden("No pharmacy is linked to this account");
  return p;
}

const startOfDay = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); };
const mask = (m: string) => `${m.slice(0, 2)}••••••${m.slice(-2)}`;

// ───────────── Inventory ─────────────

export function listInventory(user: SessionUser) {
  const p = pharmacyOf(user);
  const d = db();
  return d.inventory
    .filter((i) => i.pharmacyId === p.id)
    .map((i) => {
      const m = d.medicines.find((x) => x.id === i.medicineId)!;
      return { ...i, name: m.name, brand: m.brand, generic: m.generic, strength: m.strength, low: i.quantity <= i.lowStockThreshold, expiringSoon: Date.parse(i.expiry) - Date.now() < 90 * 86400_000 };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function upsertInventory(user: SessionUser, input: Omit<PharmacyInventory, "id" | "pharmacyId">, id?: string) {
  const p = pharmacyOf(user);
  const d = db();
  if (!d.medicines.some((m) => m.id === input.medicineId)) throw badRequest("Unknown medicine");
  if (id) {
    const row = d.inventory.find((i) => i.id === id);
    if (!row) throw notFound();
    if (row.pharmacyId !== p.id) throw forbidden();
    Object.assign(row, input);
    return row;
  }
  const existing = d.inventory.find((i) => i.pharmacyId === p.id && i.medicineId === input.medicineId && i.batch === input.batch);
  if (existing) { Object.assign(existing, input); return existing; }
  const row: PharmacyInventory = { id: uid("inv"), pharmacyId: p.id, ...input };
  d.inventory.push(row);
  return row;
}

export function quickStockUpdate(user: SessionUser, id: string, quantity: number) {
  const p = pharmacyOf(user);
  const row = db().inventory.find((i) => i.id === id);
  if (!row) throw notFound();
  if (row.pharmacyId !== p.id) throw forbidden();
  if (!Number.isInteger(quantity) || quantity < 0 || quantity > 100000) throw badRequest("Enter a valid quantity");
  row.quantity = quantity;
  return row;
}

/**
 * CSV columns: medicine,batch,expiry,mrp,sellingPrice,quantity[,lowStockThreshold]
 * `medicine` matches a catalogue name (case-insensitive). Valid rows import; invalid rows are reported with their line number.
 */
export function bulkUploadCsv(user: SessionUser, csv: string) {
  const p = pharmacyOf(user);
  const rows = parseCsv(csv);
  if (!rows.length) throw badRequest("The file is empty");
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const body = header.includes("medicine") ? rows.slice(1) : rows;
  if (body.length > 2000) throw badRequest("Please upload at most 2000 rows at a time");
  const d = db();
  const errors: { row: number; error: string }[] = [];
  let imported = 0;
  body.forEach((cols, idx) => {
    const line = idx + 2;
    const med = d.medicines.find((m) => m.name.toLowerCase() === cols[0]?.trim().toLowerCase());
    if (!med) return errors.push({ row: line, error: `Medicine "${cols[0]}" not found in catalogue` });
    const parsed = inventoryItemSchema.safeParse({ medicineId: med.id, batch: cols[1], expiry: cols[2], mrp: cols[3], sellingPrice: cols[4], quantity: cols[5], lowStockThreshold: cols[6] || 10 });
    if (!parsed.success) return errors.push({ row: line, error: parsed.error.issues[0].message });
    const existing = d.inventory.find((i) => i.pharmacyId === p.id && i.medicineId === med.id && i.batch === parsed.data.batch);
    if (existing) Object.assign(existing, parsed.data);
    else d.inventory.push({ id: uid("inv"), pharmacyId: p.id, ...parsed.data });
    imported++;
  });
  audit(user, "INVENTORY_BULK_UPLOAD", "Pharmacy", p.id, { imported, errors: errors.length });
  return { imported, errors };
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
    newOrders: orders.filter((o) => ["PENDING", "PRESCRIPTION_APPROVED"].includes(o.status)).length,
    inProgress: orders.filter((o) => ["CONFIRMED", "PREPARING", "READY_FOR_PICKUP", "RIDER_ASSIGNED", "PICKED_UP", "OUT_FOR_DELIVERY"].includes(o.status)).length,
    deliveredToday: today.length,
    revenueToday: sum(today),
    revenueTotal: sum(delivered),
    lowStock: d.inventory.filter((i) => i.pharmacyId === p.id && i.quantity <= i.lowStockThreshold).length,
    openRequests: d.medicineRequests.filter((r) => r.status === "OPEN" && p.servicePincodes.includes(r.pincode) && !d.medicineRequestResponses.some((x) => x.requestId === r.id && x.pharmacyId === p.id)).length,
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
  const callbacks = d.prescriptions.filter((rx) => rx.source === "QUICK_ORDER" && ["RECEIVED", "NEEDS_CLARIFICATION"].includes(rx.status) && (!rx.pharmacyId || rx.pharmacyId === p.id)
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
    totals: { paid: sum("PAID"), codDue: sum("COD_DUE"), pendingOnline: sum("PENDING"), refunded: sum("REFUNDED") },
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
  Object.assign(p, patch);
  audit(user, "PHARMACY_SETTINGS_UPDATED", "Pharmacy", p.id, patch as Record<string, unknown>);
  return p;
}
