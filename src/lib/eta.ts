import type { DeliveryType } from "./types";

export interface EtaInput {
  distanceKm: number;
  prepMinutes: number;
  /** true when pharmacist verification is required before packing */
  needsPrescriptionReview: boolean;
  riderAvailable: boolean;
  deliveryType: DeliveryType;
}

export interface EtaResult {
  minutes: number;
  /** Lower/upper bound shown to the user so we never over-promise */
  range: [number, number];
  breakdown: { label: string; minutes: number }[];
}

/**
 * ETA is built from real factors: distance, stock/prep, prescription verification and rider availability.
 * It never returns below 20 minutes and is always presented as a range.
 */
export function estimateEta(i: EtaInput): EtaResult {
  const speed = i.deliveryType === "PRIORITY" ? 0.45 : 0.3; // km/min (~27 / ~18 km/h on small-town roads)
  const travel = Math.ceil(i.distanceKm / speed);
  const prep = i.deliveryType === "PRIORITY" ? Math.max(5, Math.round(i.prepMinutes * 0.6)) : i.prepMinutes;
  const review = i.needsPrescriptionReview ? 15 : 0;
  const riderWait = i.riderAvailable ? 5 : 20;
  const breakdown = [
    { label: "Pharmacy preparing", minutes: prep },
    { label: "Prescription check", minutes: review },
    { label: "Finding a delivery partner", minutes: riderWait },
    { label: "Travel", minutes: travel },
  ].filter((b) => b.minutes > 0);
  const total = Math.max(20, breakdown.reduce((s, b) => s + b.minutes, 0));
  return { minutes: total, range: [total, Math.round(total * 1.4)], breakdown };
}
