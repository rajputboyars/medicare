"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";
import { Home, Pill, Bookmark, ClipboardList, User, ShoppingBag, Phone, MessageCircle, Upload, Search } from "lucide-react";
import type { ReactNode } from "react";
import { LocationPicker } from "./location-picker";
import { Logo, LogoMark } from "@/components/brand/logo";
import { useCartSync } from "@/lib/use-cart-sync";
import { useCart } from "@/lib/store";
import { SUPPORT_PHONE, SUPPORT_WA, useMe, useT } from "@/lib/hooks";
import type { Key } from "@/i18n";

const NAV: { href: string; key: Key; icon: typeof Home; match: (p: string) => boolean }[] = [
  { href: "/", key: "navHome", icon: Home, match: (p) => p === "/" },
  { href: "/medicines", key: "navMedicines", icon: Pill, match: (p) => p.startsWith("/medicines") || p.startsWith("/find-medicine") || p.startsWith("/upload-prescription") || p.startsWith("/checkout") || p.startsWith("/quick-order") },
  { href: "/repeat", key: "navSaved", icon: Bookmark, match: (p) => p.startsWith("/repeat") },
  { href: "/orders", key: "navOrders", icon: ClipboardList, match: (p) => p.startsWith("/orders") },
  { href: "/profile", key: "navProfile", icon: User, match: (p) => p.startsWith("/profile") || p.startsWith("/family") },
];

const SIDE_EXTRA = [
  { href: "/upload-prescription", label: "Upload Prescription", icon: Upload },
  { href: "/find-medicine", label: "Find My Medicine", icon: Search },
];

export function AppShell({ children }: { children: ReactNode }) {
  const path = usePathname();
  const t = useT();
  const count = useCart((s) => s.lines.reduce((n, l) => n + l.quantity, 0));
  const me = useMe();
  useCartSync();

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[15rem_1fr]">
      {/* Desktop sidebar */}
      <aside className="no-print sticky top-0 hidden h-dvh flex-col gap-1 border-r border-line bg-white p-4 lg:flex" aria-label="Main">
        <Link href="/" className="mb-4 px-2" aria-label="DawaDost home"><Logo size={40} /></Link>
        {[...NAV.map((n) => ({ href: n.href, label: t(n.key), icon: n.icon, active: n.match(path) })), ...SIDE_EXTRA.map((n) => ({ ...n, active: path.startsWith(n.href) }))].map((n) => (
          <Link key={n.href} href={n.href} aria-current={n.active ? "page" : undefined}
            className={clsx("flex min-h-12 items-center gap-3 rounded-2xl px-3 font-semibold", n.active ? "bg-brand-50 text-brand-800" : "hover:bg-stone-100")}>
            <n.icon className="size-5" aria-hidden /> {n.label}
          </Link>
        ))}
        <div className="mt-auto space-y-2">
          <a href={`tel:${SUPPORT_PHONE}`} className="flex min-h-12 items-center gap-3 rounded-2xl px-3 font-semibold hover:bg-stone-100"><Phone className="size-5" aria-hidden /> {t("callSupport")}</a>
        </div>
      </aside>

      <div className="flex min-w-0 flex-col">
        <header className="no-print sticky top-0 z-30 border-b border-line bg-white/95 backdrop-blur">
          <div className="mx-auto flex max-w-5xl items-center justify-between gap-2 px-3 py-2 sm:px-6">
            <div className="flex min-w-0 items-center gap-2">
              <Link href="/" className="grid min-h-12 min-w-12 place-items-center lg:hidden" aria-label="DawaDost home"><LogoMark className="size-10" /></Link>
              <LocationPicker />
            </div>
            <div className="flex items-center gap-1">
              <a href={`https://wa.me/${SUPPORT_WA}?text=Hello%2C%20I%20need%20help%20with%20my%20order`} className="hidden min-h-12 min-w-12 place-items-center rounded-2xl text-[#1a8d4a] hover:bg-stone-100 sm:grid" aria-label={t("whatsappSupport")}>
                <MessageCircle className="size-6" aria-hidden />
              </a>
              <Link href="/checkout" className="relative grid min-h-12 min-w-12 place-items-center rounded-2xl hover:bg-stone-100" aria-label={`Cart, ${count} items`}>
                <ShoppingBag className="size-6" aria-hidden />
                {count > 0 && <span className="absolute right-1 top-1 grid min-w-5 place-items-center rounded-full bg-brand-600 px-1 text-xs font-bold text-white">{count}</span>}
              </Link>
              {me.data === null && <Link href="/login" className="ml-1 flex min-h-12 items-center whitespace-nowrap rounded-2xl bg-brand-600 px-3.5 font-semibold text-white sm:px-4">{t("login")}</Link>}
            </div>
          </div>
        </header>

        <main id="main" className="mx-auto w-full max-w-5xl flex-1 px-3 pb-28 pt-4 sm:px-6 lg:pb-10">{children}</main>

        <footer className="no-print mx-auto hidden w-full max-w-5xl px-6 pb-8 text-sm text-muted lg:block">
          <p>Verified pharmacies only · Free cancellation before pickup · Delivery times are estimates · <a className="underline" href={`https://wa.me/${SUPPORT_WA}`}>{t("whatsappSupport")}</a></p>
          <p className="mt-1">{t("emergencyNotice")}</p>
        </footer>

        {/* Mobile bottom navigation */}
        <nav aria-label="Main" className="no-print safe-bottom fixed inset-x-0 bottom-0 z-30 border-t border-line bg-white lg:hidden">
          <ul className="mx-auto grid max-w-lg grid-cols-5">
            {NAV.map((n) => {
              const active = n.match(path);
              return (
                <li key={n.href}>
                  <Link href={n.href} aria-current={active ? "page" : undefined} className={clsx("flex min-h-16 flex-col items-center justify-center gap-0.5 text-xs font-semibold", active ? "text-brand-700" : "text-muted")}>
                    <n.icon className={clsx("size-6", active && "stroke-[2.6]")} aria-hidden />
                    {t(n.key)}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

      </div>
    </div>
  );
}
