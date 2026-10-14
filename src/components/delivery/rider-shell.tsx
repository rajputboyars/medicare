"use client";
import { useRouter } from "next/navigation";
import { Bike, History, IndianRupee, LogOut } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { post } from "@/lib/api";
import { useRiderMe } from "@/components/delivery/rider-context";
import { BottomNavigation } from "@/components/layout/bottom-navigation";
import type { NavItem } from "@/components/layout/nav";
import { InstallCard } from "@/components/pwa/install";
import { LogoMark } from "@/components/brand/logo";
import { IconButton, OperationalAlert, StatusBadge } from "@/components/ui";
import { useOnline } from "@/lib/hooks";

const TABS: NavItem[] = [
  { href: "/delivery", label: "Deliveries", icon: Bike, exact: true },
  { href: "/delivery/history", label: "History", icon: History },
  { href: "/delivery/earnings", label: "Earnings", icon: IndianRupee },
];

/** Phone-first rider app. The big Online/Offline control lives on the home screen; the header only shows the state. */
export function RiderShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const qc = useQueryClient();
  const me = useRiderMe();
  const connected = useOnline();
  const online = me.data?.available ?? false;

  return (
    <div className="mx-auto min-h-dvh max-w-lg">
      <header className="sticky top-0 z-20 border-b border-line bg-surface px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2.5"><LogoMark className="size-10" /><div className="min-w-0"><p className="whitespace-nowrap text-base font-extrabold leading-tight"><span className="text-ink">Dawa</span><span className="text-brand-600">Dost</span></p><p className="truncate text-sm text-muted">Rider · {me.data?.name ?? "…"}</p></div></div>
          <div className="flex items-center gap-2">
            {me.data && <StatusBadge tone={online ? "success" : "neutral"}>{online ? "Online" : "Offline"}</StatusBadge>}
            <IconButton label="Log out" onClick={async () => { await post("/api/auth/logout", {}); qc.clear(); router.replace("/login"); router.refresh(); }}><LogOut className="size-5" aria-hidden /></IconButton>
          </div>
        </div>
      </header>
      <main id="main" className="space-y-4 px-4 pb-28 pt-4">
        {!connected && <OperationalAlert severity="warning" title="No internet" description="Check your connection. Your delivery steps will work again when you are back online." />}
        {me.data && me.data.verification !== "VERIFIED" && <OperationalAlert severity="warning" title="Waiting for verification" description="You can accept deliveries once the DawaDost team approves your account." />}
        <div className="empty:hidden"><InstallCard appName="DawaDost Rider" storageKey="mc-rider-install-dismissed" /></div>
        {children}
      </main>
      <BottomNavigation items={TABS} label="Rider" />
    </div>
  );
}
