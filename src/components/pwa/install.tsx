"use client";
import { useEffect, useState } from "react";
import { Download, Share, WifiOff, X } from "lucide-react";
import { Button } from "@/components/ui";

interface InstallEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const isStandalone = () =>
  typeof window !== "undefined" && (window.matchMedia("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true);
const isIos = () => typeof navigator !== "undefined" && /iphone|ipad|ipod/i.test(navigator.userAgent);

/** Chrome/Android: capture `beforeinstallprompt`. iOS Safari has no prompt, so we show "Add to Home Screen" steps instead. */
export function useInstall() {
  const [event, setEvent] = useState<InstallEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  useEffect(() => {
    setInstalled(isStandalone());
    const onPrompt = (e: Event) => { e.preventDefault(); setEvent(e as InstallEvent); };
    const onInstalled = () => { setInstalled(true); setEvent(null); };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => { window.removeEventListener("beforeinstallprompt", onPrompt); window.removeEventListener("appinstalled", onInstalled); };
  }, []);
  return {
    installed,
    canPrompt: !!event,
    showIosHint: !installed && !event && isIos(),
    install: async () => { if (!event) return; await event.prompt(); await event.userChoice; setEvent(null); },
  };
}

/** Card shown where installing makes sense (profile, rider home). Hidden once installed or when not possible. */
export function InstallCard({ appName = "DawaDost", storageKey = "mc-install-dismissed" }: { appName?: string; storageKey?: string }) {
  const { installed, canPrompt, showIosHint, install } = useInstall();
  const [dismissed, setDismissed] = useState(true);
  useEffect(() => { try { setDismissed(localStorage.getItem(storageKey) === "1"); } catch { setDismissed(false); } }, [storageKey]);
  if (installed || dismissed || (!canPrompt && !showIosHint)) return null;
  const close = () => { setDismissed(true); try { localStorage.setItem(storageKey, "1"); } catch { /* private mode */ } };
  return (
    <div className="flex items-start gap-3 rounded-[1.25rem] border-2 border-brand-200 bg-brand-50 p-4">
      <Download className="mt-0.5 size-6 shrink-0 text-brand-700" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="font-bold">Install {appName}</p>
        {canPrompt ? (
          <>
            <p className="text-sm text-muted">Opens like an app, starts faster and keeps working on a weak connection.</p>
            <Button className="mt-2 min-h-11 py-2" onClick={install}>Install app</Button>
          </>
        ) : (
          <p className="text-sm text-muted">Tap <Share className="inline size-4 align-text-bottom" aria-label="Share" /> then <b>Add to Home Screen</b>.</p>
        )}
      </div>
      <button onClick={close} aria-label="Dismiss" className="grid size-10 shrink-0 place-items-center rounded-xl text-muted"><X className="size-5" aria-hidden /></button>
    </div>
  );
}

/** Slim banner while offline. Orders and prescriptions need a connection, so we say so plainly. */
export function OfflineBanner() {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    setOnline(navigator.onLine);
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => { window.removeEventListener("online", up); window.removeEventListener("offline", down); };
  }, []);
  if (online) return null;
  return (
    <div role="status" className="fixed inset-x-0 top-0 z-50 flex items-center justify-center gap-2 bg-amber-100 px-3 py-2 text-center text-sm font-semibold text-amber-900">
      <WifiOff className="size-4 shrink-0" aria-hidden /> You are offline. Your cart is saved. Orders need a connection.
    </div>
  );
}
