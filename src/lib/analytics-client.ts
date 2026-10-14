"use client";
import { api } from "./api";

/** Events the browser may report. The server decides what to do with them (any analytics vendor sits behind it). */
export type ClientEvent = "signup_started" | "location_selected" | "pharmacy_registration_started" | "rider_registration_started";

function anonId(): string {
  try {
    let id = localStorage.getItem("mc-anon");
    if (!id) { id = "a-" + Math.random().toString(36).slice(2, 12) + Date.now().toString(36).slice(-4); localStorage.setItem("mc-anon", id); }
    return id;
  } catch { return "a-unknown-device"; }
}

/** Fire and forget: analytics must never slow down or break a screen. */
export function trackEvent(name: ClientEvent, props?: Record<string, string | number | boolean>) {
  void api("/api/analytics/event", { method: "POST", json: { name, anonId: anonId(), props } }).catch(() => undefined);
}
