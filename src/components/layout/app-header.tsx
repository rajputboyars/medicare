"use client";
import Link from "next/link";
import { MessageCircle, ShoppingBag } from "lucide-react";
import type { ReactNode } from "react";
import { LogoMark, Logo } from "@/components/brand/logo";
import { LocationSelector } from "./location-selector";
import { SUPPORT_WA, useMe, useT } from "@/lib/hooks";
import { useCart } from "@/lib/store";

/**
 * Customer top bar. Logo, the compact location selector (hidden on Home, which shows a larger one in the page),
 * help on WhatsApp (from 640px), the cart with its count, and Log in when signed out.
 */
export function AppHeader({ showLocation = true, children }: { showLocation?: boolean; children?: ReactNode }) {
  const t = useT();
  const me = useMe();
  const count = useCart((s) => s.lines.reduce((n, l) => n + l.quantity, 0));
  return (
    <header className="no-print sticky top-0 z-30 border-b border-line bg-surface/95 backdrop-blur">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-2 px-3 py-2 sm:px-6">
        <div className="flex min-w-0 items-center gap-1.5">
          <Link href="/" className="tap grid place-items-center lg:hidden" aria-label="DawaDost home">
            <span className="phablet:hidden"><LogoMark className="size-10" /></span>
            <span className="hidden phablet:block"><Logo size={36} /></span>
          </Link>
          {showLocation && <LocationSelector />}
          {children}
        </div>
        <div className="flex items-center gap-1">
          <a href={`https://wa.me/${SUPPORT_WA}?text=Hello%2C%20I%20need%20help%20with%20my%20order`} aria-label={t("whatsappSupport")} className="tap hidden place-items-center rounded-control text-[#1a8d4a] hover:bg-surface-2 sm:grid">
            <MessageCircle className="size-6" aria-hidden />
          </a>
          <Link href="/checkout" aria-label={`Cart, ${count} item${count === 1 ? "" : "s"}`} className="tap relative grid place-items-center rounded-control hover:bg-surface-2">
            <ShoppingBag className="size-6" aria-hidden />
            {count > 0 && <span className="absolute right-1 top-1 grid min-w-5 place-items-center rounded-full bg-brand-600 px-1 text-xs font-bold leading-5 text-white" aria-hidden>{count}</span>}
          </Link>
          {me.data === null && <Link href="/login" className="tap ml-1 inline-flex items-center whitespace-nowrap rounded-control bg-brand-600 px-3.5 font-semibold text-white hover:bg-brand-700 sm:px-4">{t("login")}</Link>}
        </div>
      </div>
    </header>
  );
}
