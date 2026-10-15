import type { PlatformSettings, ServiceArea, ServiceAreaStatus, SessionUser, VerificationStatus } from "@/lib/types";
import { isFinal } from "@/lib/order-machine";
import { badRequest, notFound } from "@/server/errors";
import { audit, db, settings, uid } from "@/server/store";
import { riderStatusOf } from "@/server/features/delivery/delivery.service";
import { revokeAllSessions } from "../auth/session.service";
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
  const unmatched = d.matchReviews.filter((r) => r.status === "PENDING").length;
  if (unmatched) items.push({ id: "unmatched-medicines", severity: "info", title: `${unmatched} medicine${unmatched === 1 ? "" : "s"} from pharmacies not in the catalogue`, description: "Match each to an existing medicine, create it, or reject it. Nothing is added automatically.", href: "/admin/medicine-matches", actionLabel: "Review" });
  const pendingPh = d.pharmacies.filter((p) => p.verification === "PENDING").length;
  if (pendingPh) items.push({ id: "pending-pharmacies", severity: "warning", title: `${pendingPh} pharmacy approval${pendingPh === 1 ? "" : "s"} waiting`, description: "Check the drug licence, then approve or reject with a reason.", href: "/admin/verification", actionLabel: "Review" });
  const pendingRid = d.deliveryPartners.filter((p) => p.verification === "PENDING").length;
  if (pendingRid) items.push({ id: "pending-riders", severity: "info", title: `${pendingRid} delivery partner${pendingRid === 1 ? "" : "s"} waiting for approval`, description: "They cannot take deliveries until approved.", href: "/admin/verification", actionLabel: "Review" });
  const tickets = d.tickets.filter((t) => t.status !== "RESOLVED");
  if (tickets.length) items.push({ id: "complaints", severity: tickets.some((t) => mins(t.createdAt) > 24 * 60) ? "critical" : "warning", title: `${tickets.length} open complaint${tickets.length === 1 ? "" : "s"}`, description: "Customers are waiting for an answer.", href: "/admin/complaints", actionLabel: "Open" });
  const failedDeliveries = d.deliveries.filter((x) => x.status === "DELIVERY_FAILED" || x.status === "RETURNED_TO_PHARMACY").length;
  if (failedDeliveries) items.push({ id: "failed-deliveries", severity: "critical", title: `${failedDeliveries} delivery problem${failedDeliveries === 1 ? "" : "s"}`, description: "A parcel could not be delivered or is back at the pharmacy. Choose to try again, bring it back, or cancel and refund.", href: "/admin/delivery-issues", actionLabel: "Open" });
  const failedRefunds = d.refunds.filter((r) => r.status === "FAILED").length;
  if (failedRefunds) items.push({ id: "failed-refunds", severity: "critical", title: `${failedRefunds} refund${failedRefunds === 1 ? "" : "s"} did not go through`, description: "The customer is waiting for their money. Try the refund again.", href: "/admin/delivery-issues", actionLabel: "Open" });
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
    pendingMatches: d.matchReviews.filter((r) => r.status === "PENDING").length,
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
  const waiting = interestCounts();
  return db().serviceAreas.map((a) => ({ ...a, launchSignups: a.pincode ? (waiting.get(a.pincode) ?? 0) : 0 }));
}

export function setServiceArea(actor: SessionUser, id: string, status: ServiceAreaStatus) {
  const a = db().serviceAreas.find((x) => x.id === id);
  if (!a) throw notFound();
  const from = a.status;
  a.status = status;
  audit(actor, "SERVICE_AREA_STATUS_CHANGED", "ServiceArea", id, { from, to: status });
  return a;
}

export function addServiceArea(actor: SessionUser, input: Omit<ServiceArea, "id">) {
  const d = db();
  if (d.serviceAreas.some((a) => a.level === input.level && a.name.toLowerCase() === input.name.toLowerCase())) throw badRequest("This area already exists");
  const a: ServiceArea = { id: uid("sa"), ...input };
  d.serviceAreas.push(a);
  audit(actor, "SERVICE_AREA_CREATED", "ServiceArea", a.id);
  return a;
}

import { interestCounts, registerInterest } from "@/server/features/service-areas/service-areas.service";
export { coverageFor, type Coverage } from "@/server/features/service-areas/service-areas.service";

/** Kept for the old "leave your number" form: it now records a ServiceAreaInterest. */
export const launchSignup = (mobile: string, pincode: string) => registerInterest({ mobile, pincode });

// ───────────── Lists for the admin tables ─────────────

export type AdminEntity = "customers" | "orders" | "requests" | "payments" | "settlements" | "complaints" | "audit" | "issues";
export const ADMIN_ENTITIES: readonly AdminEntity[] = ["customers", "orders", "requests", "payments", "settlements", "complaints", "audit", "issues"];

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
    case "issues": {
      // Things support must act on: deliveries that failed or came back, and refunds that did not go through
      const deliveries = d.deliveries
        .filter((x) => ["DELIVERY_FAILED", "RETURNING_TO_PHARMACY", "RETURNED_TO_PHARMACY"].includes(x.status) && d.orders.find((o) => o.id === x.orderId)?.status === "OUT_FOR_DELIVERY")
        .map((x) => {
          const o = d.orders.find((y) => y.id === x.orderId)!;
          return { id: x.id, kind: "DELIVERY", orderId: o.id, orderCode: o.code, status: x.status, detail: x.failureReasonCode ?? "", attemptNo: x.attemptNo ?? 1, pharmacy: d.pharmacies.find((p) => p.id === o.pharmacyId)?.name, rider: d.deliveryPartners.find((p) => p.id === x.partnerId)?.name, paymentMethod: o.paymentMethod, paymentStatus: o.paymentStatus, total: o.total, createdAt: x.failedAt ?? x.createdAt };
        });
      const refunds = d.refunds.filter((r) => r.status === "FAILED").map((r) => ({ id: r.id, kind: "REFUND", orderId: r.orderId, orderCode: d.orders.find((o) => o.id === r.orderId)?.code, status: r.status, detail: r.failureMessage ?? "", paymentId: r.paymentId, refundKey: r.idempotencyKey, total: r.amount, createdAt: r.updatedAt }));
      return [...deliveries, ...refunds];
    }
  }
}

// ───────────── Settlements ─────────────

// Settlement logic lives in features/settlements; re-exported so admin callers keep one import.
export { generateSettlements, setSettlementStatus, adjustSettlement } from "@/server/features/settlements/settlements.service";

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

/** Every account for the admin screens. Password hashes never leave the server. */
export function adminUsers() {
  const d = db();
  return d.users.map(({ passwordHash: _h, failedLogins: _f, lockedUntil: _l, mfa: _m, ...u }) => {
    void _h; void _f; void _l; void _m;
    return { ...u, orders: d.orders.filter((o) => o.userId === u.id).length };
  });
}

/** Suspending an account signs the person out everywhere, immediately. */
export function setUserStatus(actor: SessionUser, userId: string, status: "ACTIVE" | "SUSPENDED") {
  const u = db().users.find((x) => x.id === userId);
  if (!u) throw notFound("User not found");
  if (u.id === actor.id) throw badRequest("You cannot suspend your own account");
  if (u.role === "SUPER_ADMIN") throw badRequest("Admin accounts cannot be suspended here");
  u.status = status;
  const revoked = status === "SUSPENDED" ? revokeAllSessions(u.id, "account-suspended") : 0;
  audit(actor, status === "SUSPENDED" ? "USER_SUSPENDED" : "USER_REINSTATED", "User", u.id, { revoked });
  return { id: u.id, status: u.status, sessionsRevoked: revoked };
}

export function revokeUserSessions(actor: SessionUser, userId: string) {
  if (!db().users.some((x) => x.id === userId)) throw notFound("User not found");
  const revoked = revokeAllSessions(userId, "admin-revoked");
  audit(actor, "SESSIONS_REVOKED", "User", userId, { revoked });
  return { revoked };
}
