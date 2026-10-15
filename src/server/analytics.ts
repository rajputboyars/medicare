import type { AnalyticsEventName, AnalyticsRecord } from "@/lib/types";
import { db, uid } from "./store";

/**
 * Product analytics, not tied to any vendor.
 *
 * Code anywhere calls `track(name, ...)`. Where the event goes is decided by the registered sinks:
 *   - the built-in sink keeps the latest events in our own database (for the admin funnel)
 *   - add PostHog, Mixpanel, GA4, BigQuery... by calling `registerAnalyticsSink({ name, handle })` at startup
 * A failing sink never breaks a request. Events carry an opaque user id or anonymous id, and small non-sensitive properties:
 * never a mobile number, never anything medical.
 */
export const ANALYTICS_EVENTS: readonly AnalyticsEventName[] = [
  "signup_started", "otp_requested", "otp_verified", "location_selected", "signup_completed",
  "pharmacy_registration_started", "pharmacy_application_submitted", "pharmacy_approved", "inventory_added",
  "rider_registration_started", "rider_application_submitted", "first_order_completed",
];

/** Events the browser may report itself (the rest are only ever recorded by the server). */
export const CLIENT_EVENTS: readonly AnalyticsEventName[] = ["signup_started", "location_selected", "pharmacy_registration_started", "rider_registration_started"];

export interface AnalyticsSink { name: string; handle(event: AnalyticsRecord): void }

const MAX_STORED = 5000;
const ownSink: AnalyticsSink = {
  name: "database",
  handle(e) {
    const list = db().analytics;
    list.push(e);
    if (list.length > MAX_STORED) list.splice(0, list.length - MAX_STORED);
  },
};

const g = globalThis as unknown as { __mcSinks?: AnalyticsSink[] };
const sinks = (g.__mcSinks ??= [ownSink]);

export function registerAnalyticsSink(sink: AnalyticsSink) {
  if (!sinks.some((s) => s.name === sink.name)) sinks.push(sink);
}
export const unregisterAnalyticsSink = (name: string) => { const i = sinks.findIndex((s) => s.name === name); if (i >= 0) sinks.splice(i, 1); };

type Props = Record<string, string | number | boolean>;
const SAFE_KEY = /^[a-z_]{1,30}$/;

export function track(name: AnalyticsEventName, who: { userId?: string; anonId?: string } = {}, props?: Props) {
  const clean: Props = {};
  for (const [k, v] of Object.entries(props ?? {})) if (SAFE_KEY.test(k) && (typeof v === "boolean" || typeof v === "number" || (typeof v === "string" && v.length <= 60))) clean[k] = v;
  const event: AnalyticsRecord = { id: uid("ev"), name, userId: who.userId, anonId: who.anonId, props: Object.keys(clean).length ? clean : undefined, at: new Date().toISOString() };
  for (const s of sinks) {
    try { s.handle(event); } catch (e) { console.error(`[analytics] sink ${s.name} failed`, (e as Error).message); }
  }
}

/** Counts per event, for a funnel view. */
export function analyticsSummary(sinceMs = 30 * 86400_000) {
  const since = Date.now() - sinceMs;
  const counts: Record<string, number> = Object.fromEntries(ANALYTICS_EVENTS.map((n) => [n, 0]));
  for (const e of db().analytics) if (Date.parse(e.at) >= since) counts[e.name] = (counts[e.name] ?? 0) + 1;
  return counts;
}
