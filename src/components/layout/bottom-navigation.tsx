"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";
import { isActive, type NavItem } from "./nav";

/**
 * Bottom tab bar for phones (customer and rider apps). The current tab is shown three ways: a filled pill behind the icon,
 * bold label, and aria-current, so it never relies on colour alone.
 */
export function BottomNavigation({ items, label = "Main" }: { items: NavItem[]; label?: string }) {
  const path = usePathname();
  return (
    <nav aria-label={label} className="no-print safe-bottom fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface shadow-[0_-4px_16px_rgb(20_35_42/0.05)] lg:hidden">
      <ul className="mx-auto grid max-w-lg" style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}>
        {items.map((n) => {
          const active = isActive(n, path);
          return (
            <li key={n.href}>
              <Link href={n.href} aria-current={active ? "page" : undefined} className="flex min-h-[4.25rem] flex-col items-center justify-center gap-1 px-1">
                <span className={clsx("relative grid h-8 w-16 place-items-center rounded-pill transition-colors", active ? "bg-brand-100 text-brand-800" : "text-muted")}>
                  <n.icon className={clsx("size-6", active && "stroke-[2.4]")} aria-hidden />
                  {!!n.badge && <span className="absolute -right-0.5 -top-0.5 grid min-w-5 place-items-center rounded-full bg-brand-600 px-1 text-[0.7rem] font-bold leading-5 text-white" aria-label={`${n.badge} waiting`}>{n.badge}</span>}
                </span>
                <span className={clsx("text-xs leading-none", active ? "font-extrabold text-brand-800" : "font-semibold text-muted")}>{n.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
