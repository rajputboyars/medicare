"use client";
import { usePathname } from "next/navigation";
import { ClipboardList, Home, Pill, Phone, Repeat, SearchCheck, Upload, User, Users } from "lucide-react";
import type { ReactNode } from "react";
import { AppHeader } from "./app-header";
import { BottomNavigation } from "./bottom-navigation";
import { Sidebar } from "./sidebar";
import type { NavItem } from "./nav";
import { useCartSync } from "@/lib/use-cart-sync";
import { SUPPORT_PHONE, SUPPORT_WA, useT } from "@/lib/hooks";

/** Customer navigation: four tabs on phones; the desktop sidebar adds the quick actions underneath. */
export function customerNav(t: ReturnType<typeof useT>): NavItem[] {
  return [
    { href: "/", label: t("navHome"), icon: Home, exact: true },
    { href: "/medicines", label: t("navMedicines"), icon: Pill, also: ["/find-medicine", "/upload-prescription", "/checkout", "/quick-order"] },
    { href: "/orders", label: t("navOrders"), icon: ClipboardList, also: ["/repeat"] },
    { href: "/profile", label: t("navProfile"), icon: User, also: ["/family"] },
  ];
}

export function AppShell({ children }: { children: ReactNode }) {
  const path = usePathname();
  const t = useT();
  useCartSync();
  const items = customerNav(t);
  const quick: NavItem[] = [
    { href: "/upload-prescription", label: t("uploadPrescription"), icon: Upload },
    { href: "/find-medicine", label: t("findMyMedicine"), icon: SearchCheck },
    { href: "/repeat", label: t("repeatOrder"), icon: Repeat },
    { href: "/family", label: "Family profiles", icon: Users },
  ];

  return (
    <div className="min-h-dvh lg:flex">
      <Sidebar items={items} secondary={{ heading: "Quick actions", items: quick }}
        footer={<a href={`tel:${SUPPORT_PHONE}`} className="tap flex items-center gap-3 rounded-control px-3 font-semibold hover:bg-surface-2"><Phone className="size-5" aria-hidden /> {t("callSupport")}</a>} />

      <div className="flex min-w-0 flex-1 flex-col">
        <AppHeader showLocation={path !== "/"} />
        <main id="main" className="mx-auto w-full max-w-5xl flex-1 px-3 pb-28 pt-5 sm:px-6 lg:pb-12 2xl:max-w-6xl">{children}</main>

        <footer className="no-print mx-auto hidden w-full max-w-5xl px-6 pb-8 lg:block 2xl:max-w-6xl">
          <p className="t-caption">Verified pharmacies only · Free cancellation before pickup · Delivery times are estimates · <a className="underline" href={`https://wa.me/${SUPPORT_WA}`}>{t("whatsappSupport")}</a></p>
          <p className="t-caption mt-1">{t("emergencyNotice")}</p>
        </footer>
        <BottomNavigation items={items} />
      </div>
    </div>
  );
}
