import bcrypt from "bcryptjs";
import type { PlatformSettings, ServiceArea, ServiceAreaStatus, SessionUser, Settlement, VerificationStatus } from "@/lib/types";
import { isFinal } from "@/lib/order-machine";
import { badRequest, notFound } from "@/server/errors";
import { audit, db, settings, uid } from "@/server/store";
import { riderStatusOf } from "@/server/features/delivery/delivery.service";
import { requestResponses } from "@/server/features/medicine-requests/requests.service";

const startOfDay = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); };

export interface AttentionItem { id: string; severity: "info" | "warning" | "critical"; title: string; description: string; href: string; actionLabel: string }

/** Things an operator should look at now, most urgent first. Plain sentences, each with a place to act. */
export function attentionItems(now = Date.now()): AttentionItem[] {
  const d = db();
  const mins = (iso: string) => Math.round((now - Date.parse(iso)) / 60_000);
  const items: AttentionItem[] = [];
  const stuckPending = d.orders.filter((o) => ["PENDING", "PRESCRIPTION_REVIEW"].includes(o.status) && mins(o.createdAt) > 20);
  if (stuckPending.length) {
    const oldest = Math.max(...stuckPending.map((o) => mins(o.createdAt)));
    items.push({ id: "stuck-pending", severity: oldest > 60 ? "critical" : "warning", title: `${stuckPending.length} order${stuckPending.length === 1 ? " is" : "s are"} waiting for a pharmacy`, description: `The oldest has waited ${oldest} minutes. Call the pharmacy or ask the customer to wait.`, href: "/admin/orders", actionLabel: "See orders" });
  }
  const noRider = d.orders.filter((o) => o.status === "READY_FOR_PICKUP" && !o.deliveryPartnerId && mins(o.statusHistory.at(-1)?.at ?? o.createdAt) > 15);
  if (noRider.length) items.push({ id: "no-rider", severity: "critical", title: `${noRider.length} ready order${noRider.length === 1 ? " has" : "s have"} no delivery partner`, description: "They have been ready for more than 15 minutes. Check that riders are online.", href: "/admin/riders", actionLabel: "See riders" });
  const unanswered = d.medicineRequests.filter((r) => r.status === "SEARCHING" && mins(r.createdAt) > 30 && !d.medicineRequestResponses.some((x) => x.requestId === r.id));
  if (unanswered.length) items.push({ id: "unanswered", severity: "warning", title: `${unanswered.length} medicine request${unanswered.length === 1 ? " has" : "s have"} no reply`, description: "No pharmacy has answered for over 30 minutes.", href: "/admin/requests", actionLabel: "See requests" });
  const pendingPh = d.pharmacies.filter((p) => p.verification === "PENDING").length;
  if (pendingPh) items.push({ id: "pending-pharmacies", severity: "warning", title: `${pendingPh} pharmacy approval${pendingPh === 1 ? "" : "s"} waiting`, description: "Check the drug licence, then approve or reject with a reason.", href: "/admin/verification", actionLabel: "Review" });
  const pendingRid = d.deliveryPartners.filter((p) => p.verification === "PENDING").length;
  if (pendingRid) items.push({ id: "pending-riders", severity: "info", title: `${pendingRid} delivery partner${pendingRid === 1 ? "" : "s"} waiting for approval`, description: "They cannot take deliveries until approved.", href: "/admin/verification", actionLabel: "Review" });
  const tickets = d.tickets.filter((t) => t.status !== "RESOLVED");
  if (tickets.length) items.push({ id: "complaints", severity: tickets.some((t) => mins(t.createdAt) > 24 * 60) ? "critical" : "warning", title: `${tickets.length} open complaint${tickets.length === 1 ? "" : "s"}`, description: "Customers are waiting for an answer.", href: "/admin/complaints", actionLabel: "Open" });
  const unsettled = d.orders.filter((o) => o.status === "DELIVERED" && !o.settlementId).length;
  if (unsettled) items.push({ id: "unsettled", severity: "info", title: `${unsettled} delivered order${unsettled === 1 ? "" : "s"} not settled yet`, description: "Create settlements to pay the pharmacies.", href: "/admin/settlements", actionLabel: "Settle" });
  const rank = { critical: 0, warning: 1, info: 2 };
  return items.sort((a, b) => rank[a.severity] - rank[b.severity]);
}

export function adminStats() {
  const d = db();
  const today = d.orders.filter((o) => Date.parse(o.createdAt) >= startOfDay());
  const billable = d.orders.filter((o) => o.status !== "CANCELLED");
  return {
    ordersToday: today.length,
    gmv: billable.reduce((s, o) => s + o.total, 0),
    customers: d.users.filter((u) => u.role === "CUSTOMER").length,
    activePharmacies: d.pharmacies.filter((p) => p.verification === "VERIFIED").length,
    pendingPharmacyApprovals: d.pharmacies.filter((p) => p.verification === "PENDING").length,
    ridersOnline: d.deliveryPartners.filter((p) => p.available).length,
    ridersVerified: d.deliveryPartners.filter((p) => p.verification === "VERIFIED").length,
    pendingRiderApprovals: d.deliveryPartners.filter((p) => p.verification === "PENDING").length,
    deliveries: d.deliveries.filter((x) => x.status === "DELIVERED").length,
    cancelledOrders: d.orders.filter((o) => o.status === "CANCELLED").length,
    liveOrders: d.orders.filter((o) => !isFinal(o.status)).length,
    openRequests: d.medicineRequests.filter((r) => r.status === "SEARCHING").length,
    openTickets: d.tickets.filter((t) => t.status !== "RESOLVED").length,
    pendingSettlements: d.settlements.filter((s) => s.status !== "PAID").length,
    pendingApprovals: d.pharmacies.filter((p) => p.verification === "PENDING").length + d.deliveryPartners.filter((p) => p.verification === "PENDING").length,
    attention: attentionItems(),
  };
}

// ───────────── Partner verification ─────────────

const KINDS = { pharmacies: "pharmacies", riders: "deliveryPartners" } as const;
export type PartnerKind = keyof typeof KINDS;
export const isPartnerKind = (k: string): k is PartnerKind => k in KINDS;

export function listPharmacyRows() {
  const d = db();
  return d.pharmacies.map((p) => {
    const orders = d.orders.filter((o) => o.pharmacyId === p.id);
    return { ...p, orders: orders.length, delivered: orders.filter((o) => o.status === "DELIVERED").length, revenue: orders.filter((o) => o.status === "DELIVERED").reduce((s, o) => s + o.total, 0), stockLines: d.inventory.filter((i) => i.pharmacyId === p.id).length };
  });
}

export function listRiderRows() {
  const d = db();
  return d.deliveryPartners.map((r) => {
    const done = d.deliveries.filter((x) => x.partnerId === r.id && x.status === "DELIVERED");
    return { ...r, status: riderStatusOf(r), deliveries: done.length, earned: done.reduce((s, x) => s + x.payout, 0) };
  });
}

export const listPartners = (kind: PartnerKind) => (kind === "pharmacies" ? listPharmacyRows() : listRiderRows());

export function setVerification(actor: SessionUser, kind: PartnerKind, id: string, status: VerificationStatus, note?: string) {
  const d = db();
  const row = kind === "pharmacies" ? d.pharmacies.find((x) => x.id === id) : d.deliveryPartners.find((x) => x.id === id);
  if (!row) throw notFound("Partner not found");
  if ((status === "REJECTED" || status === "SUSPENDED") && !note?.trim()) throw badRequest("Please add a reason");
  const before = row.verification;
  row.verification = status;
  if (status !== "VERIFIED") {
    if ("acceptingOrders" in row) row.acceptingOrders = false;
    if ("available" in row) row.available = false;
  } else if ("acceptingOrders" in row) row.acceptingOrders = true;
  audit(actor, `VERIFICATION_${status}`, kind, id, { before, note });
  return row;
}

// ───────────── Service areas & launch sign-ups ─────────────

export function listServiceAreas() {
  return db().serviceAreas.map((a) => ({ ...a, launchSignups: a.launchSignups.length }));
}

export function setServiceArea(actor: SessionUser, id: string, status: ServiceAreaStatus) {
  const a = db().serviceAreas.find((x) => x.id === id);
  if (!a) throw notFound();
  const from = a.status;
  a.status = status;
  audit(actor, "SERVICE_AREA_STATUS_CHANGED", "ServiceArea", id, { from, to: status });
  return a;
}

export function addServiceArea(actor: SessionUser, input: Omit<ServiceArea, "id" | "launchSignups">) {
  const d = db();
  if (d.serviceAreas.some((a) => a.level === input.level && a.name.toLowerCase() === input.name.toLowerCase())) throw badRequest("This area already exists");
  const a: ServiceArea = { id: uid("sa"), ...input, launchSignups: [] };
  d.serviceAreas.push(a);
  audit(actor, "SERVICE_AREA_CREATED", "ServiceArea", a.id);
  return a;
}

export { coverageFor, type Coverage } from "@/server/features/service-areas/service-areas.service";

export function launchSignup(mobile: string, pincode: string) {
  const d = db();
  let area = d.serviceAreas.find((a) => a.level === "PINCODE" && a.pincode === pincode);
  if (!area) {
    area = { id: uid("sa"), level: "PINCODE", name: pincode, state: "Unknown", pincode, status: "COMING_SOON", launchSignups: [] };
    d.serviceAreas.push(area);
  }
  if (!area.launchSignups.includes(mobile)) area.launchSignups.push(mobile);
  return { ok: true };
}

// ───────────── Lists for the admin tables ─────────────

export type AdminEntity = "customers" | "orders" | "requests" | "payments" | "settlements" | "complaints" | "audit";
export const ADMIN_ENTITIES: readonly AdminEntity[] = ["customers", "orders", "requests", "payments", "settlements", "complaints", "audit"];

export function adminList(entity: AdminEntity) {
  const d = db();
  switch (entity) {
    case "customers":
      return d.users.filter((u) => u.role === "CUSTOMER").map((u) => {
        const orders = d.orders.filter((o) => o.userId === u.id);
        return { id: u.id, name: u.name, mobile: u.mobile, email: u.email, joinedAt: u.createdAt, orders: orders.length, spent: orders.filter((o) => o.status === "DELIVERED").reduce((s, o) => s + o.total, 0), family: d.familyMembers.filter((f) => f.userId === u.id).length };
      });
    // Delivery OTPs and file keys never leave the server.
    case "orders":
      return d.orders.map((o) => ({
        id: o.id, code: o.code, status: o.status, total: o.total, paymentMethod: o.paymentMethod, paymentStatus: o.paymentStatus, deliveryType: o.deliveryType, createdAt: o.createdAt,
        customer: d.users.find((u) => u.id === o.userId)?.name, pharmacy: d.pharmacies.find((p) => p.id === o.pharmacyId)?.name, rider: d.deliveryPartners.find((p) => p.id === o.deliveryPartnerId)?.name,
        itemCount: o.items.length, hasPrescription: o.items.some((i) => i.prescriptionRequired),
      }));
    case "requests":
      return d.medicineRequests.map((r) => ({ ...r, responses: requestResponses(r.id).length, available: d.medicineRequestResponses.filter((x) => x.requestId === r.id && x.response === "AVAILABLE").length }));
    case "payments":
      return d.payments.map((p) => ({ ...p, orderCode: d.orders.find((o) => o.id === p.orderId)?.code })).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    case "settlements":
      return d.settlements.map((s) => ({ ...s, partner: s.partnerType === "PHARMACY" ? d.pharmacies.find((p) => p.id === s.partnerId)?.name : d.deliveryPartners.find((p) => p.id === s.partnerId)?.name })).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    case "complaints":
      return d.tickets.map((t) => ({ ...t, customer: d.users.find((u) => u.id === t.userId)?.name ?? "Guest", orderCode: d.orders.find((o) => o.id === t.orderId)?.code }));
    case "audit":
      return d.audit.slice(0, 300);
  }
}

// ───────────── Settlements ─────────────

/** Creates one PENDING settlement per pharmacy for delivered orders that are not settled yet. */
export function generateSettlements(actor: SessionUser): Settlement[] {
  const d = db();
  const pct = settings().commissionPercent;
  const created: Settlement[] = [];
  for (const p of d.pharmacies) {
    const due = d.orders.filter((o) => o.pharmacyId === p.id && o.status === "DELIVERED" && !o.settlementId);
    if (!due.length) continue;
    const gross = due.reduce((s, o) => s + o.subtotal - o.discount, 0); // delivery fees belong to the platform / riders
    const commission = Math.round((gross * pct) / 100);
    const s: Settlement = {
      id: uid("set"), partnerType: "PHARMACY", partnerId: p.id, periodStart: due.map((o) => o.createdAt).sort()[0], periodEnd: new Date().toISOString(),
      orderCount: due.length, gross, commission, net: gross - commission, status: "PENDING", createdAt: new Date().toISOString(),
    };
    d.settlements.push(s);
    for (const o of due) o.settlementId = s.id;
    created.push(s);
  }
  audit(actor, "SETTLEMENTS_GENERATED", "Settlement", "*", { count: created.length });
  return created;
}

export function setSettlementStatus(actor: SessionUser, id: string, status: Settlement["status"]) {
  const s = db().settlements.find((x) => x.id === id);
  if (!s) throw notFound();
  const order = ["PENDING", "PROCESSING", "PAID"];
  if (order.indexOf(status) < order.indexOf(s.status)) throw badRequest("A settlement cannot move backwards");
  s.status = status;
  audit(actor, "SETTLEMENT_STATUS", "Settlement", id, { status });
  return s;
}

// ───────────── Complaints ─────────────

export function createTicket(userId: string, input: { subject: string; message: string; orderId?: string }) {
  const d = db();
  if (input.orderId && !d.orders.some((o) => o.id === input.orderId && o.userId === userId)) throw badRequest("Unknown order");
  const t = { id: uid("tk"), userId, ...input, status: "OPEN" as const, createdAt: new Date().toISOString() };
  d.tickets.unshift(t);
  return t;
}

export function updateTicket(actor: SessionUser, id: string, status: "OPEN" | "IN_PROGRESS" | "RESOLVED") {
  const t = db().tickets.find((x) => x.id === id);
  if (!t) throw notFound();
  t.status = status;
  audit(actor, "TICKET_STATUS", "SupportTicket", id, { status });
  return t;
}

// ───────────── Reports & settings ─────────────

export function platformReports() {
  const d = db();
  const days = Array.from({ length: 7 }, (_, i) => {
    const day = new Date(); day.setHours(0, 0, 0, 0); day.setDate(day.getDate() - (6 - i));
    const end = day.getTime() + 86400_000;
    const xs = d.orders.filter((o) => Date.parse(o.createdAt) >= day.getTime() && Date.parse(o.createdAt) < end);
    return { label: day.toLocaleDateString("en-IN", { weekday: "short" }), orders: xs.length, gmv: xs.filter((o) => o.status !== "CANCELLED").reduce((s, o) => s + o.total, 0), cancelled: xs.filter((o) => o.status === "CANCELLED").length };
  });
  const byPharmacy = d.pharmacies.map((p) => {
    const xs = d.orders.filter((o) => o.pharmacyId === p.id && o.status === "DELIVERED");
    return { name: p.name, orders: xs.length, revenue: xs.reduce((s, o) => s + o.total, 0) };
  }).sort((a, b) => b.revenue - a.revenue).slice(0, 5);
  const meds = new Map<string, { name: string; qty: number }>();
  for (const o of d.orders.filter((x) => x.status !== "CANCELLED")) for (const i of o.items) { const m = meds.get(i.medicineId) ?? { name: i.name, qty: 0 }; m.qty += i.quantity; meds.set(i.medicineId, m); }
  const reasons = new Map<string, number>();
  for (const o of d.orders.filter((x) => x.status === "CANCELLED")) reasons.set(o.cancelReason ?? "No reason given", (reasons.get(o.cancelReason ?? "No reason given") ?? 0) + 1);
  const requests = d.medicineRequests;
  return {
    days, topPharmacies: byPharmacy, topMedicines: [...meds.values()].sort((a, b) => b.qty - a.qty).slice(0, 5),
    cancellationReasons: [...reasons.entries()].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count),
    requests: { total: requests.length, found: requests.filter((r) => r.status === "FOUND").length, open: requests.filter((r) => r.status === "SEARCHING").length },
    rxShare: d.orders.length ? Math.round((d.orders.filter((o) => o.items.some((i) => i.prescriptionRequired)).length / d.orders.length) * 100) : 0,
  };
}

export function updatePlatformSettings(actor: SessionUser, patch: Partial<PlatformSettings>) {
  const s = settings();
  Object.assign(s, patch);
  audit(actor, "PLATFORM_SETTINGS_UPDATED", "Settings", "platform", patch as Record<string, unknown>);
  return s;
}

// ───────────── Partner self-registration (always lands as PENDING) ─────────────

export function registerPharmacy(input: {
  ownerName: string; mobile: string; email: string; password: string; name: string; drugLicense: string; gstin?: string;
  address: string; pincode: string; district: string; servicePincodes: string[]; openTime: string; closeTime: string;
}) {
  const d = db();
  if (d.users.some((u) => u.mobile === input.mobile || u.email?.toLowerCase() === input.email.toLowerCase())) throw badRequest("An account with this mobile or email already exists");
  if (d.pharmacies.some((p) => p.drugLicense.toLowerCase() === input.drugLicense.toLowerCase())) throw badRequest("This drug licence is already registered");
  const pharmacyId = uid("ph");
  d.pharmacies.push({
    id: pharmacyId, name: input.name, ownerName: input.ownerName, mobile: input.mobile, drugLicense: input.drugLicense, gstin: input.gstin || undefined,
    verification: "PENDING", address: input.address, pincode: input.pincode, district: input.district,
    location: { lat: 0, lng: 0 }, // set during onboarding from the shop's map pin
    servicePincodes: input.servicePincodes, deliveryRadiusKm: 5, openTime: input.openTime, closeTime: input.closeTime,
    priorityDelivery: false, avgPrepMinutes: 15, rating: 0, ratingCount: 0, acceptingOrders: false,
  });
  d.users.push({
    id: uid("u"), name: input.ownerName, mobile: input.mobile, email: input.email, passwordHash: bcrypt.hashSync(input.password, 10),
    role: "PHARMACY_ADMIN", partnerId: pharmacyId, language: "en", consent: { healthData: true, marketing: false, acceptedAt: new Date().toISOString() }, createdAt: new Date().toISOString(),
  });
  return { pharmacyId, status: "PENDING" as const };
}

export function registerRider(input: { name: string; mobile: string; email: string; password: string; vehicle: string }) {
  const d = db();
  if (d.users.some((u) => u.mobile === input.mobile || u.email?.toLowerCase() === input.email.toLowerCase())) throw badRequest("An account with this mobile or email already exists");
  const partnerId = uid("dp");
  d.deliveryPartners.push({ id: partnerId, name: input.name, mobile: input.mobile, vehicle: input.vehicle, verification: "PENDING", available: false, joinedAt: new Date().toISOString() });
  const userId = uid("u");
  d.users.push({
    id: userId, name: input.name, mobile: input.mobile, email: input.email, passwordHash: bcrypt.hashSync(input.password, 10), role: "DELIVERY_PARTNER", partnerId,
    language: "en", consent: { healthData: false, marketing: false, acceptedAt: new Date().toISOString() }, createdAt: new Date().toISOString(),
  });
  d.deliveryPartners.find((p) => p.id === partnerId)!.userId = userId;
  return { partnerId, status: "PENDING" as const };
}

/** Every account for the admin screens. Password hashes never leave the server. */
export function adminUsers() {
  const d = db();
  return d.users.map(({ passwordHash: _h, ...u }) => {
    void _h;
    return { ...u, orders: d.orders.filter((o) => o.userId === u.id).length };
  });
}
