import type { DeliveryType, PlatformSettings } from "./types";

export type EtaConfig = NonNullable<PlatformSettings["eta"]>;

/** Used when an admin has not changed anything. All numbers live in platform settings (`eta`), so they can be tuned without a deploy. */
export const DEFAULT_ETA: EtaConfig = { riderAssignMinutes: 5, noRiderMinutes: 20, reviewMinutes: 15, normalKmPerMin: 0.3, priorityKmPerMin: 0.45, minMinutes: 20, rangeFactor: 1.4 };

export interface EtaInput {
  distanceKm: number;
  prepMinutes: number;
  /** true when pharmacist verification is required before packing */
  needsPrescriptionReview: boolean;
  riderAvailable: boolean;
  deliveryType: DeliveryType;
  config?: Partial<EtaConfig>;
}

export interface EtaResult {
  minutes: number;
  /** Lower/upper bound shown to the user so we never over-promise */
  range: [number, number];
  breakdown: { label: string; minutes: number }[];
}

/**
 * ETA is built from real parts, each configurable:
 *   pharmacy preparation + prescription check + finding a rider (shorter when riders are online) + travel (distance ÷ speed).
 * It never goes below the configured minimum and is always presented as a range (e.g. 30–40 min), never as one exact minute.
 */
export function estimateEta(i: EtaInput): EtaResult {
  const c = { ...DEFAULT_ETA, ...i.config };
  const speed = i.deliveryType === "PRIORITY" ? c.priorityKmPerMin : c.normalKmPerMin;
  const travel = Math.ceil(i.distanceKm / speed);
  const prep = i.deliveryType === "PRIORITY" ? Math.max(5, Math.round(i.prepMinutes * 0.6)) : i.prepMinutes;
  const review = i.needsPrescriptionReview ? c.reviewMinutes : 0;
  const riderWait = i.riderAvailable ? c.riderAssignMinutes : c.noRiderMinutes;
  const breakdown = [
    { label: "Pharmacy preparing", minutes: prep },
    { label: "Prescription check", minutes: review },
    { label: "Finding a delivery partner", minutes: riderWait },
    { label: "Travel", minutes: travel },
  ].filter((b) => b.minutes > 0);
  const total = Math.max(c.minMinutes, breakdown.reduce((s, b) => s + b.minutes, 0));
  // Round the range to 5 minutes so "32–45" becomes "30–45": honest about the precision
  const lo = Math.floor(total / 5) * 5 || c.minMinutes;
  return { minutes: total, range: [lo, Math.ceil((total * c.rangeFactor) / 5) * 5], breakdown };
}
