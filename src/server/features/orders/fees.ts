import { distanceKm } from "@/lib/geo";
import type { Address, DeliveryFeeRule, DeliveryType, GeoPoint, Order, PlatformSettings, Pharmacy } from "@/lib/types";
import { badRequest } from "@/server/errors";
import { db } from "@/server/store";

/**
 * Delivery fee, worked out on the server from rules an admin controls. The client never sends a fee.
 *
 * Rule lookup: the MOST SPECIFIC service area that has a feeRule wins (pincode → town → district → state). Without one, the
 * platform settings apply (flat fee, free above a threshold, flat priority fee).
 *
 *   area rule:  fee = max(minFee, baseFee + max(0, distance − includedDistanceKm) × perKmFee), capped at maxFee
 *               priority adds prioritySurcharge · normal delivery is free above the platform "free delivery" threshold
 *               nothing is delivered beyond maxServiceRadiusKm from the pharmacy
 *
 * The result and how it was made are frozen on the order (`deliveryFee`, `feeBreakdown`).
 */
export type FeeBreakdown = NonNullable<Order["feeBreakdown"]>;

const eq = (a?: string, b?: string) => !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();

export function feeRuleFor(addr: Pick<Address, "pincode" | "town" | "district" | "state">): DeliveryFeeRule | undefined {
  const areas = db().serviceAreas.filter((a) => a.feeRule && a.status === "ACTIVE");
  return (
    areas.find((a) => a.level === "PINCODE" && a.pincode === addr.pincode) ??
    areas.find((a) => a.level === "TOWN" && eq(a.town ?? a.name, addr.town)) ??
    areas.find((a) => a.level === "DISTRICT" && eq(a.district ?? a.name, addr.district)) ??
    areas.find((a) => a.level === "STATE" && eq(a.state ?? a.name, addr.state))
  )?.feeRule;
}

/** Straight-line km from the pharmacy to the delivery address; undefined when the address has no map pin. */
export const distanceBetween = (pharmacy: Pick<Pharmacy, "location">, address: { location?: GeoPoint }) => (address.location ? Math.round(distanceKm(pharmacy.location, address.location) * 10) / 10 : undefined);

export function computeDeliveryFee(i: { subtotal: number; type: DeliveryType; distanceKm?: number; address: Pick<Address, "pincode" | "town" | "district" | "state">; cfg: PlatformSettings }): { fee: number; breakdown: FeeBreakdown } {
  const rule = feeRuleFor(i.address);
  const free = i.type === "NORMAL" && i.subtotal >= i.cfg.freeDeliveryAbove;
  if (!rule) {
    const fee = i.type === "PRIORITY" ? i.cfg.priorityDeliveryFee : free ? 0 : i.cfg.normalDeliveryFee;
    return { fee, breakdown: { base: fee, distanceCharge: 0, prioritySurcharge: 0, freeDelivery: free, distanceKm: i.distanceKm, rule: "PLATFORM" } };
  }
  if (i.distanceKm !== undefined && i.distanceKm > rule.maxServiceRadiusKm) throw badRequest(`This address is ${i.distanceKm} km away. We deliver up to ${rule.maxServiceRadiusKm} km from the pharmacy.`);
  const extra = Math.max(0, (i.distanceKm ?? 0) - rule.includedDistanceKm);
  const distanceCharge = Math.round(extra * rule.perKmFee);
  let fee = Math.max(rule.minFee, rule.baseFee + distanceCharge);
  if (rule.maxFee !== undefined) fee = Math.min(fee, rule.maxFee);
  const surcharge = i.type === "PRIORITY" ? rule.prioritySurcharge : 0;
  if (free) fee = 0;
  return { fee: fee + surcharge, breakdown: { base: rule.baseFee, distanceCharge, prioritySurcharge: surcharge, freeDelivery: free, distanceKm: i.distanceKm, rule: "AREA" } };
}
