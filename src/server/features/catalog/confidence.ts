import type { StockConfidence } from "@/lib/types";

/**
 * How much to trust a stock figure. Stock is only as good as the last time the pharmacy touched it, so we say so honestly
 * instead of promising "in stock". The thresholds are settings, not magic numbers:
 *
 *   updated within HIGH hours    → HIGH   "recently updated"
 *   updated within MEDIUM hours  → MEDIUM "may have changed"
 *   older                        → LOW    "pharmacy confirmation may be needed"
 *
 * Override with STOCK_CONFIDENCE_HIGH_HOURS / STOCK_CONFIDENCE_MEDIUM_HOURS (e.g. a busy city might want 2 and 12).
 */
export interface ConfidencePolicy { highWithinHours: number; mediumWithinHours: number }

export function confidencePolicy(): ConfidencePolicy {
  const num = (v: string | undefined, d: number) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : d; };
  const high = num(process.env.STOCK_CONFIDENCE_HIGH_HOURS, 12);
  const medium = Math.max(high, num(process.env.STOCK_CONFIDENCE_MEDIUM_HOURS, 72));
  return { highWithinHours: high, mediumWithinHours: medium };
}

export function stockConfidence(lastUpdatedAt: string | undefined, now = Date.now(), policy = confidencePolicy()): StockConfidence {
  const t = lastUpdatedAt ? Date.parse(lastUpdatedAt) : NaN;
  if (Number.isNaN(t)) return "LOW";
  const hours = Math.max(0, (now - t) / 3600_000);
  return hours <= policy.highWithinHours ? "HIGH" : hours <= policy.mediumWithinHours ? "MEDIUM" : "LOW";
}

/** Plain-words description for screens. Never claims more than we know. */
export const confidenceNote = (c: StockConfidence) =>
  c === "HIGH" ? "Stock updated recently" : c === "MEDIUM" ? "Stock may have changed since the last update" : "Stock not updated for a while. The pharmacy may need to confirm.";
