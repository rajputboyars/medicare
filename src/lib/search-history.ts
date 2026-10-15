"use client";
import { useCallback, useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./api";
import { useMe } from "./hooks";

/**
 * Recent searches.
 *  - Guests: kept only in THIS browser (localStorage). Nothing is sent to the server.
 *  - Signed-in customers: kept on their own account (private to them), so they follow them to another phone.
 * "Clear" removes them everywhere they are kept.
 */
const KEY = "mc-recent-searches";
const MAX = 8;

function readLocal(): string[] {
  try { const v = JSON.parse(localStorage.getItem(KEY) ?? "[]"); return Array.isArray(v) ? v.filter((x) => typeof x === "string").slice(0, MAX) : []; } catch { return []; }
}
function writeLocal(list: string[]) {
  try { localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX))); } catch { /* private mode: fine, just not remembered */ }
}

export function useRecentSearches() {
  const me = useMe();
  const qc = useQueryClient();
  const signedIn = me.data?.role === "CUSTOMER";
  const [local, setLocal] = useState<string[]>([]);
  useEffect(() => setLocal(readLocal()), []);

  const server = useQuery({ queryKey: ["search-history"], queryFn: () => api<{ id: string; query: string }[]>("/api/me/search-history"), enabled: signedIn, staleTime: 30_000 });
  const items = signedIn ? (server.data ?? []).map((h) => h.query).slice(0, MAX) : local;

  /** The server records a signed-in customer's search itself; guests are remembered locally. */
  const remember = useCallback((q: string) => {
    const t = q.trim();
    if (t.length < 2) return;
    if (signedIn) { void qc.invalidateQueries({ queryKey: ["search-history"] }); return; }
    const next = [t, ...readLocal().filter((x) => x.toLowerCase() !== t.toLowerCase())].slice(0, MAX);
    writeLocal(next); setLocal(next);
  }, [signedIn, qc]);

  const clear = useCallback(async () => {
    writeLocal([]); setLocal([]);
    if (signedIn) { await api("/api/me/search-history", { method: "DELETE" }); await qc.invalidateQueries({ queryKey: ["search-history"] }); }
  }, [signedIn, qc]);

  return { items, remember, clear };
}
