import type { DeliveryType, Offer } from "./types";

export interface FeeConfig {
  normalDeliveryFee: number;
  priorityDeliveryFee: number;
  freeDeliveryAbove: number;
}

export const DEFAULT_FEES: FeeConfig = { normalDeliveryFee: 25, priorityDeliveryFee: 49, freeDeliveryAbove: 499 };

export function deliveryFee(subtotal: number, type: DeliveryType, cfg: FeeConfig = DEFAULT_FEES): number {
  if (type === "PRIORITY") return cfg.priorityDeliveryFee;
  return subtotal >= cfg.freeDeliveryAbove ? 0 : cfg.normalDeliveryFee;
}

export function applyOffer(subtotal: number, offer?: Offer): number {
  if (!offer || !offer.active || subtotal < offer.minOrder) return 0;
  return Math.min(offer.maxDiscount, Math.round((subtotal * offer.percentOff) / 100));
}

export const inr = (n: number) => `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
