"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";
import { LogOut } from "lucide-react";
import type { ReactNode } from "react";
import { Logo } from "@/components/brand/logo";
import { isActive, type NavItem } from "./nav";

/** Desktop sidebar shared by the customer app, pharmacy portal and admin. Hidden below 1024px (phones use BottomNavigation or MobileNavStrip). */
export function Sidebar({ title, user, items, secondary, footer, onLogout }: {
  title?: string; user?: string; items: NavItem[]; secondary?: { heading: string; items: NavItem[] }; footer?: ReactNode; onLogout?: () => void;
}) {
  const path = usePathname();
  const link = (n: NavItem) => {
    const active = isActive(n, path);
    return (
      <li key={n.href}>
        <Link href={n.href} aria-current={active ? "page" : undefined}
          className={clsx("tap relative flex items-center gap-3 rounded-control px-3 py-2 font-semibold", active ? "bg-brand-50 font-bold text-brand-800" : "text-ink hover:bg-surface-2")}>
          {active && <span aria-hidden className="absolute left-0 top-2 bottom-2 w-1 rounded-r bg-brand-600" />}
          <n.icon className="size-5 shrink-0" aria-hidden />
          <span className="min-w-0 flex-1 leading-tight">{n.label}</span>
          {!!n.badge && <span className="grid min-w-6 place-items-center rounded-full bg-brand-600 px-1.5 text-xs font-bold leading-6 text-white" aria-label={`${n.badge} waiting`}>{n.badge}</span>}
        </Link>
      </li>
    );
  };
  return (
    <aside className="no-print sticky top-0 hidden h-dvh w-64 shrink-0 flex-col gap-1 overflow-y-auto border-r border-line bg-surface p-4 lg:flex xl:w-[17rem]" aria-label={title ? `${title} navigation` : "Main"}>
      <Link href="/" aria-label="DawaDost home" className="mb-1 inline-flex px-2"><Logo size={38} /></Link>
      {title && <p className="px-2 text-xs font-bold uppercase tracking-wider text-muted">{title}</p>}
      {user && <p className="mb-3 truncate px-2 t-caption">{user}</p>}
      <nav aria-label={title ?? "Main"} className="mt-2"><ul className="flex flex-col gap-1">{items.map(link)}</ul></nav>
      {secondary && (
        <nav aria-label={secondary.heading} className="mt-4">
          <p className="mb-1 px-2 text-xs font-bold uppercase tracking-wider text-muted">{secondary.heading}</p>
          <ul className="flex flex-col gap-1">{secondary.items.map(link)}</ul>
        </nav>
      )}
      <div className="mt-auto space-y-1 pt-4">
        {footer}
        {onLogout && <button type="button" onClick={onLogout} className="tap flex w-full items-center gap-3 rounded-control px-3 font-semibold hover:bg-surface-2"><LogOut className="size-5" aria-hidden /> Log out</button>}
      </div>
    </aside>
  );
}

/** Phone navigation for the business dashboards: a scrollable strip of large pills under the top bar. */
export function MobileNavStrip({ items, label }: { items: NavItem[]; label: string }) {
  const path = usePathname();
  return (
    <nav aria-label={label} className="no-print border-t border-line lg:hidden">
      <ul className="flex gap-2 overflow-x-auto px-3 py-2">
        {items.map((n) => {
          const active = isActive(n, path);
          return (
            <li key={n.href} className="shrink-0">
              <Link href={n.href} aria-current={active ? "page" : undefined}
                className={clsx("flex min-h-11 items-center gap-2 rounded-pill px-4 text-sm", active ? "bg-brand-600 font-bold text-white" : "bg-surface-2 font-semibold text-ink")}>
                <n.icon className="size-4" aria-hidden /> {n.label}
                {!!n.badge && <span className={clsx("grid min-w-5 place-items-center rounded-full px-1 text-xs font-bold leading-5", active ? "bg-white text-brand-800" : "bg-brand-600 text-white")}>{n.badge}</span>}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
