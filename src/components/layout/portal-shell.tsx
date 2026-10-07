"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import clsx from "clsx";
import { LogOut } from "lucide-react";
import type { ComponentType, ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { post } from "@/lib/api";
import { useMe } from "@/lib/hooks";

export interface PortalNavItem { href: string; label: string; icon: ComponentType<{ className?: string }>; exact?: boolean }

/** Dashboard layout for partner portals: sidebar on desktop, scrollable tab bar on phones. */
export function PortalShell({ title, nav, children }: { title: string; nav: PortalNavItem[]; children: ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const qc = useQueryClient();
  const me = useMe();
  const active = (n: PortalNavItem) => (n.exact ? path === n.href : path === n.href || path.startsWith(`${n.href}/`));

  async function logout() {
    await post("/api/auth/logout", {});
    qc.clear();
    router.replace("/login");
    router.refresh();
  }

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[15rem_1fr]">
      <aside className="hidden h-dvh flex-col border-r border-line bg-white p-4 lg:sticky lg:top-0 lg:flex" aria-label={`${title} navigation`}>
        <p className="mb-1 flex items-center gap-2 text-lg font-extrabold text-brand-700"><span className="grid size-8 place-items-center rounded-lg bg-brand-600 text-white" aria-hidden>+</span> {title}</p>
        <p className="mb-4 truncate px-1 text-sm text-muted">{me.data?.name}</p>
        <nav className="flex flex-col gap-1">
          {nav.map((n) => (
            <Link key={n.href} href={n.href} aria-current={active(n) ? "page" : undefined} className={clsx("flex min-h-12 items-center gap-3 rounded-2xl px-3 font-semibold", active(n) ? "bg-brand-50 text-brand-800" : "hover:bg-stone-100")}>
              <n.icon className="size-5" aria-hidden /> {n.label}
            </Link>
          ))}
        </nav>
        <button onClick={logout} className="mt-auto flex min-h-12 items-center gap-3 rounded-2xl px-3 font-semibold hover:bg-stone-100"><LogOut className="size-5" aria-hidden /> Log out</button>
      </aside>
      <div className="min-w-0">
        <header className="sticky top-0 z-20 border-b border-line bg-white lg:hidden">
          <div className="flex items-center justify-between px-3 py-2"><p className="font-extrabold text-brand-700">{title}</p><button onClick={logout} className="grid min-h-11 min-w-11 place-items-center rounded-xl" aria-label="Log out"><LogOut className="size-5" aria-hidden /></button></div>
          <nav className="flex gap-1 overflow-x-auto px-2 pb-2" aria-label={`${title} navigation`}>
            {nav.map((n) => (
              <Link key={n.href} href={n.href} aria-current={active(n) ? "page" : undefined} className={clsx("flex min-h-11 shrink-0 items-center gap-2 rounded-xl px-3 text-sm font-semibold", active(n) ? "bg-brand-600 text-white" : "bg-stone-100")}>
                <n.icon className="size-4" aria-hidden /> {n.label}
              </Link>
            ))}
          </nav>
        </header>
        <main id="main" className="mx-auto w-full max-w-6xl px-3 py-5 sm:px-6">{children}</main>
      </div>
    </div>
  );
}
