"use client";
import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import type { ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { post } from "@/lib/api";
import { useMe } from "@/lib/hooks";
import { LogoMark } from "@/components/brand/logo";
import { IconButton } from "@/components/ui";
import { MobileNavStrip, Sidebar } from "./sidebar";
import type { NavItem } from "./nav";

export type PortalNavItem = NavItem;

/**
 * Business dashboard layout (pharmacy, admin). Desktop-first: fixed sidebar from 1024px, content up to 1280px,
 * wider screens keep generous gutters. On phones the sidebar becomes a scrollable strip of large tabs.
 */
export function PortalShell({ title, nav, children }: { title: string; nav: NavItem[]; children: ReactNode }) {
  const router = useRouter();
  const qc = useQueryClient();
  const me = useMe();

  async function logout() {
    await post("/api/auth/logout", {});
    qc.clear();
    router.replace("/login");
    router.refresh();
  }

  return (
    <div className="min-h-dvh lg:flex">
      <Sidebar title={title} user={me.data?.name} items={nav} onLogout={logout} />
      <div className="min-w-0 flex-1">
        <header className="no-print sticky top-0 z-20 border-b border-line bg-surface lg:hidden">
          <div className="flex items-center justify-between px-3 py-2">
            <span className="flex items-center gap-2.5"><LogoMark className="size-9" /><span className="font-extrabold">{title}</span></span>
            <IconButton label="Log out" onClick={logout}><LogOut className="size-5" aria-hidden /></IconButton>
          </div>
          <MobileNavStrip items={nav} label={`${title} navigation`} />
        </header>
        <main id="main" className="mx-auto w-full max-w-7xl px-3 py-5 sm:px-6 lg:px-8 lg:py-8">{children}</main>
      </div>
    </div>
  );
}
