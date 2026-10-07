"use client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";
import { useCart, useLocation, usePrefs } from "@/lib/store";
import { OfflineBanner } from "@/components/pwa/install";

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
    el.lang = lang;
  }, [large, contrast, lang]);

  return <QueryClientProvider client={client}><OfflineBanner />{children}</QueryClientProvider>;
}
