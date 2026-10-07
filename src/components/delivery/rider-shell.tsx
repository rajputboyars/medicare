"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import clsx from "clsx";
import { Bike, History, IndianRupee, LogOut } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { post } from "@/lib/api";
import { useRiderMe, useToggleOnline } from "@/components/delivery/rider-context";
import { InstallCard } from "@/components/pwa/install";

const TABS = [
  { href: "/delivery", label: "Deliveries", icon: Bike, exact: true },
  { href: "/delivery/history", label: "History", icon: History },
  { href: "/delivery/earnings", label: "Earnings", icon: IndianRupee },
];

export function RiderShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const path = usePathname();
  const qc = useQueryClient();
  const me = useRiderMe();
  const toggle = useToggleOnline();
  const online = me.data?.available ?? false;

  return (
    <div className="mx-auto min-h-dvh max-w-lg">
      <header className="sticky top-0 z-20 border-b border-line bg-white px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0"><p className="whitespace-nowrap text-base font-extrabold text-brand-700">MediCare Rider</p><p className="truncate text-sm text-muted">{me.data?.name ?? "…"}</p></div>
          <div className="flex items-center gap-2">
            <button role="switch" aria-checked={online} aria-label={online ? "You are online. Tap to go offline" : "You are offline. Tap to go online"} disabled={!me.data || toggle.isPending} onClick={() => toggle.mutate(!online)}
              className={clsx("flex min-h-12 items-center gap-2 rounded-full border-2 px-3 text-sm font-extrabold disabled:opacity-60", online ? "border-green-600 bg-ok-50 text-ok" : "border-line bg-stone-100 text-muted")}>
              <span className={clsx("h-6 w-11 rounded-full p-0.5", online ? "bg-green-600" : "bg-stone-300")}><span className={clsx("block size-5 rounded-full bg-white transition-transform", online && "translate-x-5")} /></span>
              {online ? "Online" : "Offline"}
            </button>
            <button aria-label="Log out" className="grid min-h-12 min-w-12 place-items-center rounded-xl" onClick={async () => { await post("/api/auth/logout", {}); qc.clear(); router.replace("/login"); router.refresh(); }}><LogOut className="size-5" aria-hidden /></button>
          </div>
        </div>
        {toggle.isError && <p role="alert" className="mt-2 text-sm font-medium text-emergency">{(toggle.error as Error).message}</p>}
        {me.data && me.data.verification !== "VERIFIED" && <p className="mt-2 rounded-xl bg-warn-50 p-2 text-sm text-warn">Your account is waiting for verification. You can accept deliveries once approved.</p>}
      </header>
      <main id="main" className="px-3 pb-28 pt-4">
        <div className="mb-4 empty:hidden"><InstallCard appName="MediCare Rider" storageKey="mc-rider-install-dismissed" /></div>
        {children}
      </main>
      <nav aria-label="Rider" className="safe-bottom fixed inset-x-0 bottom-0 z-20 mx-auto max-w-lg border-t border-line bg-white">
        <ul className="grid grid-cols-3">
          {TABS.map((t) => {
            const active = t.exact ? path === t.href : path.startsWith(t.href);
            return <li key={t.href}><Link href={t.href} aria-current={active ? "page" : undefined} className={clsx("flex min-h-16 flex-col items-center justify-center gap-0.5 text-xs font-semibold", active ? "text-brand-700" : "text-muted")}><t.icon className="size-6" aria-hidden />{t.label}</Link></li>;
          })}
        </ul>
      </nav>
    </div>
  );
}
