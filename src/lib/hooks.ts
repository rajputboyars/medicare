"use client";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "./api";
import { translate, type Key, type Lang } from "@/i18n";
import { usePrefs } from "./store";
import type { Role, UserPreferences } from "./types";

export interface Me {
  id: string; name: string; mobile: string; email?: string; role: Role; partnerId?: string; language: Lang;
  pincode?: string; district?: string; preferences: UserPreferences; mfaEnabled: boolean;
  consent: { healthData: boolean; marketing: boolean };
}

export function useMe() {
  return useQuery({ queryKey: ["me"], queryFn: () => api<{ user: Me | null }>("/api/auth/me").then((r) => r.user), staleTime: 60_000 });
}

export function useT() {
  const lang = usePrefs((s) => s.lang);
  return (key: Key, vars?: Record<string, string | number>) => translate(lang, key, vars);
}

export const SUPPORT_PHONE = process.env.NEXT_PUBLIC_SUPPORT_PHONE ?? "+911800000000";
export const SUPPORT_WA = process.env.NEXT_PUBLIC_SUPPORT_WHATSAPP ?? "911800000000";

export function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}
export function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

/** "12 min ago", "3 h ago", "2 days ago". Used for stock freshness and request age. */
export function fmtAgo(iso: string | undefined, now = Date.now()): string {
  if (!iso) return "recently";
  const m = Math.max(0, Math.round((now - Date.parse(iso)) / 60_000));
  if (m < 2) return "just now";
  if (m < 60) return `${m} min ago`;
  if (m < 60 * 24) return `${Math.round(m / 60)} h ago`;
  const d = Math.round(m / 1440);
  return `${d} day${d === 1 ? "" : "s"} ago`;
}

/** True while the browser has a connection. Forms use it to disable submit and say why. */
export function useOnline() {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    setOnline(navigator.onLine);
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => { window.removeEventListener("online", up); window.removeEventListener("offline", down); };
  }, []);
  return online;
}

/** Current time that refreshes every `everyMs` (default 30s), so "waiting 12 min" stays honest without impure calls in render. */
export function useNow(everyMs = 30_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(t);
  }, [everyMs]);
  return now;
}
