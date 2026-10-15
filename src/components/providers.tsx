"use client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";
import { useCart, useLocation, usePrefs } from "@/lib/store";
import { OfflineBanner } from "@/components/pwa/install";
import { post } from "@/lib/api";
import { ElevationPrompt } from "@/components/admin/elevation-prompt";
import { useMe } from "@/lib/hooks";

export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            gcTime: 5 * 60_000,
            refetchOnWindowFocus: false,
            // Flaky networks: retry network errors, never retry 4xx
            retry: (n, e) => {
              const status = (e as unknown as { status?: number }).status ?? 0;
              return n < 2 && !(status > 0 && status < 500);
            },
          },
        },
      }),
  );

  const large = usePrefs((s) => s.large);
  const contrast = usePrefs((s) => s.highContrast);
  const controls = usePrefs((s) => s.controls);
  const simple = usePrefs((s) => s.simple);
  const lang = usePrefs((s) => s.lang);

  useEffect(() => {
    void usePrefs.persist.rehydrate();
    void useLocation.persist.rehydrate();
    void useCart.persist.rehydrate();
    // Service worker: production only (in dev it would cache stale bundles). Set NEXT_PUBLIC_SW_DEV=1 to test it locally.
    if ("serviceWorker" in navigator && (process.env.NODE_ENV === "production" || process.env.NEXT_PUBLIC_SW_DEV === "1")) {
      navigator.serviceWorker.register("/sw.js", { scope: "/" }).then((reg) => {
        // Pick up new versions quietly: check on load; the new worker activates on the next visit.
        reg.update().catch(() => undefined);
      }).catch(() => undefined);
    }
  }, []);

  useEffect(() => {
    const el = document.documentElement;
    el.dataset.large = String(large);
    el.dataset.contrast = contrast ? "high" : "normal";
    el.dataset.controls = String(controls);
    el.dataset.simple = String(simple);
    el.lang = lang;
  }, [large, contrast, controls, simple, lang]);

  return <QueryClientProvider client={client}><OfflineBanner /><AccountSync /><ElevationPrompt />{children}</QueryClientProvider>;
}

/**
 * When someone is signed in, their saved comfort settings and language follow them to this device, and the session is
 * kept alive (refreshed at most once every few hours while the app is open).
 */
function AccountSync() {
  const me = useMe();
  const u = me.data;
  useEffect(() => {
    if (!u) return;
    const p = usePrefs.getState();
    p.setLarge(u.preferences.largeText); p.setControls(u.preferences.largeControls); p.setSimple(u.preferences.simplified); p.setHighContrast(u.preferences.highContrast);
    p.setLang(u.language);
  }, [u]);
  useEffect(() => {
    if (!u) return;
    const key = "mc-session-refreshed";
    const last = Number(localStorage.getItem(key) ?? 0);
    if (Date.now() - last < 6 * 3600_000) return;
    localStorage.setItem(key, String(Date.now()));
    void post("/api/auth/refresh", {}).catch(() => undefined);
  }, [u]);
  return null;
}
