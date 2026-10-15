import type { Delivery, Order, SessionUser, Settlement, SettlementComponents, SettlementStatus } from "@/lib/types";
import { badRequest, conflict, notFound } from "@/server/errors";
import { audit, db, settings, uid } from "@/server/store";
import { atomically } from "@/server/tx";

/**
 * Settlements: what the platform owes partners.
 *
 * PHARMACY, for each delivered order not yet settled
 *   medicine revenue            Σ item prices (after any items the customer agreed to drop)
 *   − discount allocation       the part of an offer discount the PHARMACY bears (the rest is the platform's cost)
 *   − platform commission       commissionPercent of (revenue − discount allocation)
 *   − refund adjustment         money refunded to the customer after delivery (refunds for dropped items are not counted: they are not in the revenue)
 *   ± manual adjustments        added by an admin with a reason, audited
 *   = net payable
 *   Delivery fee and platform fee belong to the platform and riders, never to the pharmacy.
 *
 * RIDER, for each delivered delivery not yet settled
 *   base earning + distance earning + incentive ± adjustments = net earning
 *
 * STATUS   PENDING ─(hold period over)▶ ELIGIBLE ─▶ PROCESSING ─▶ PAID
 *                                                       └──────▶ FAILED ─▶ PROCESSING (retry)
 *          PENDING | ELIGIBLE | PROCESSING ─▶ ON_HOLD ─▶ back to PENDING / ELIGIBLE      PAID is final
 */
const round = (n: number) => Math.round(n * 100) / 100;
const MONEY_FLOW: Record<SettlementStatus, SettlementStatus[]> = {
  PENDING: ["ON_HOLD"],
  ELIGIBLE: ["PROCESSING", "ON_HOLD"],
  PROCESSING: ["PAID", "FAILED", "ON_HOLD"],
  FAILED: ["PROCESSING", "ON_HOLD"],
  ON_HOLD: ["PENDING", "ELIGIBLE"],
  PAID: [],
};

export function pharmacyComponents(orders: Order[]): { components: SettlementComponents; gross: number; commission: number; net: number } {
  const d = db();
  const cfg = settings();
  const share = (cfg.discountPlatformSharePercent ?? 100) / 100;
  const revenue = orders.reduce((s, o) => s + o.subtotal, 0);
  const discountBorne = orders.reduce((s, o) => s + o.discount * (1 - share), 0);
  const gross = round(revenue - discountBorne);
  const commission = Math.round((gross * cfg.commissionPercent) / 100);
  const refunded = orders.reduce((s, o) => {
    const rs = d.refunds.filter((r) => r.orderId === o.id && r.status === "COMPLETED" && !r.idempotencyKey.startsWith("partial:"));
    return s + Math.min(rs.reduce((x, r) => x + r.amount, 0), o.subtotal);
  }, 0);
  const components: SettlementComponents = { medicineRevenue: round(revenue), discountAllocation: 0 - round(discountBorne), platformCommission: 0 - commission, refundAdjustment: 0 - round(refunded), adjustment: 0 };
  return { components, gross, commission, net: round(gross - commission - refunded) };
}

export function riderComponents(deliveries: Delivery[]): { components: SettlementComponents; gross: number; net: number } {
  const base = deliveries.reduce((s, x) => s + (x.earning?.base ?? x.payout), 0);
  const distance = deliveries.reduce((s, x) => s + (x.earning?.distance ?? 0), 0);
  const incentive = deliveries.reduce((s, x) => s + (x.earning?.incentive ?? 0), 0);
  const total = round(base + distance + incentive);
  return { components: { baseEarning: round(base), distanceEarning: round(distance), incentive: round(incentive), adjustment: 0 }, gross: total, net: total };
}

/** Net payable right now: the computed amount plus every manual adjustment. */
export function netOf(s: Settlement): number {
  const adj = (s.adjustments ?? []).reduce((x, a) => x + a.amount, 0);
  if (s.partnerType === "PHARMACY") return round(s.gross - s.commission + (s.components?.refundAdjustment ?? 0) + adj);
  return round(s.gross + adj);
}

/** Creates PENDING settlements: one per pharmacy for its delivered orders, one per rider for their delivered deliveries. */
export function generateSettlements(actor: SessionUser): Settlement[] {
  return atomically(["settlements", "orders", "deliveries", "audit"], () => {
    const d = db();
    const hold = (settings().settlementHoldHours ?? 24) * 3600_000;
    const created: Settlement[] = [];
    const nowIso = new Date().toISOString();
    for (const p of d.pharmacies) {
      const due = d.orders.filter((o) => o.pharmacyId === p.id && o.status === "DELIVERED" && !o.settlementId);
      if (!due.length) continue;
      const calc = pharmacyComponents(due);
      const lastDone = Math.max(...due.map((o) => Date.parse(o.statusHistory.findLast((h) => h.status === "DELIVERED")?.at ?? o.createdAt)));
      const s: Settlement = {
        id: uid("set"), partnerType: "PHARMACY", partnerId: p.id, periodStart: due.map((o) => o.createdAt).sort()[0], periodEnd: nowIso, orderCount: due.length,
        gross: calc.gross, commission: calc.commission, net: calc.net, status: "PENDING", components: calc.components, orderIds: due.map((o) => o.id),
        eligibleAt: new Date(lastDone + hold).toISOString(), createdAt: nowIso,
      };
      d.settlements.push(s);
      for (const o of due) o.settlementId = s.id;
      created.push(s);
    }
    for (const r of d.deliveryPartners) {
      const due = d.deliveries.filter((x) => x.partnerId === r.id && x.status === "DELIVERED" && !x.settlementId);
      if (!due.length) continue;
      const calc = riderComponents(due);
      const lastDone = Math.max(...due.map((x) => Date.parse(x.deliveredAt ?? x.createdAt)));
      const s: Settlement = {
        id: uid("set"), partnerType: "DELIVERY", partnerId: r.id, periodStart: due.map((x) => x.createdAt).sort()[0], periodEnd: nowIso, orderCount: due.length,
        gross: calc.gross, commission: 0, net: calc.net, status: "PENDING", components: calc.components, deliveryIds: due.map((x) => x.id),
        eligibleAt: new Date(lastDone + hold).toISOString(), createdAt: nowIso,
      };
      d.settlements.push(s);
      for (const x of due) x.settlementId = s.id;
      created.push(s);
    }
    audit(actor, "SETTLEMENTS_GENERATED", "Settlement", "*", { count: created.length, ids: created.map((s) => s.id) });
    promoteEligibleSettlements();
    return created;
  });
}

/** PENDING → ELIGIBLE once the hold period is over. Run by the housekeeping timer and after generation. */
export function promoteEligibleSettlements(at = Date.now()): number {
  let n = 0;
  for (const s of db().settlements) {
    if (s.status === "PENDING" && s.eligibleAt && Date.parse(s.eligibleAt) <= at) { s.status = "ELIGIBLE"; n++; }
  }
  return n;
}

export function setSettlementStatus(actor: SessionUser, id: string, status: SettlementStatus, holdReason?: string) {
  const s = db().settlements.find((x) => x.id === id);
  if (!s) throw notFound("Settlement not found");
  if (s.status === status) return s;
  promoteEligibleSettlements();
  if (s.status === "PAID") throw conflict("A paid settlement cannot be changed");
  let target = status;
  if (s.status === "ON_HOLD" && status === "ELIGIBLE" && s.eligibleAt && Date.parse(s.eligibleAt) > Date.now()) target = "PENDING"; // still inside the hold period
  if (!MONEY_FLOW[s.status].includes(target)) {
    if (s.status === "PENDING" && (status === "PROCESSING" || status === "PAID")) throw conflict("This settlement is still in its hold period and cannot be paid yet");
    throw badRequest(`A settlement cannot go from ${s.status.replace("_", " ").toLowerCase()} to ${status.replace("_", " ").toLowerCase()}`);
  }
  if (target === "ON_HOLD" && !holdReason?.trim()) throw badRequest("Say why this settlement is on hold");
  const before = { status: s.status };
  s.status = target;
  if (target === "ON_HOLD") s.holdReason = holdReason;
  else s.holdReason = undefined;
  if (target === "PAID") s.paidAt = new Date().toISOString();
  audit(actor, "SETTLEMENT_STATUS", "Settlement", id, { status: target, holdReason }, { before, after: { status: target } });
  return s;
}

/** A signed correction on a settlement that is not paid yet (for example a rider incentive, or a penalty). Always with a reason. */
export function adjustSettlement(actor: SessionUser, id: string, amount: number, reason: string) {
  const s = db().settlements.find((x) => x.id === id);
  if (!s) throw notFound("Settlement not found");
  if (s.status === "PAID") throw conflict("A paid settlement cannot be adjusted. Add the correction to the next settlement.");
  if (!reason.trim()) throw badRequest("Please give a reason for the adjustment");
  if (!Number.isFinite(amount) || amount === 0) throw badRequest("Enter an amount that is not zero");
  const before = { net: s.net, adjustments: s.adjustments?.length ?? 0 };
  s.adjustments = [...(s.adjustments ?? []), { id: uid("adj"), amount: round(amount), reason: reason.trim(), by: actor.id, at: new Date().toISOString() }];
  s.components = { ...(s.components ?? { adjustment: 0 }), adjustment: round(s.adjustments.reduce((x, a) => x + a.amount, 0)) };
  s.net = netOf(s);
  audit(actor, "SETTLEMENT_ADJUSTED", "Settlement", id, { amount, reason }, { before, after: { net: s.net, adjustments: s.adjustments.length } });
  return s;
}
