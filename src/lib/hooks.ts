"use client";
import { useQuery } from "@tanstack/react-query";
import { api } from "./api";
import { translate, type Key } from "@/i18n";
import { usePrefs } from "./store";
import type { Role } from "./types";

export interface Me {
  id: string; name: string; mobile: string; email?: string; role: Role; partnerId?: string; language: "en" | "hi";
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
