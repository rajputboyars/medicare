"use client";
import { BadgeCheck, Bike, ClipboardList, Coins, CreditCard, LayoutDashboard, LifeBuoy, LineChart, MapPinned, ScrollText, Search, Settings, Store, Users } from "lucide-react";
import { PortalShell } from "@/components/layout/portal-shell";

const NAV = [
  { href: "/admin", label: "Dashboard", icon: LayoutDashboard, exact: true },
  { href: "/admin/customers", label: "Customers", icon: Users },
  { href: "/admin/pharmacies", label: "Pharmacies", icon: Store },
  { href: "/admin/verification", label: "Pharmacy Verification", icon: BadgeCheck },
  { href: "/admin/orders", label: "Orders", icon: ClipboardList },
  { href: "/admin/requests", label: "Medicine Requests", icon: Search },
  { href: "/admin/riders", label: "Riders", icon: Bike },
  { href: "/admin/service-areas", label: "Service Areas", icon: MapPinned },
  { href: "/admin/payments", label: "Payments", icon: CreditCard },
  { href: "/admin/settlements", label: "Settlements", icon: Coins },
  { href: "/admin/complaints", label: "Complaints", icon: LifeBuoy },
  { href: "/admin/reports", label: "Reports", icon: LineChart },
  { href: "/admin/settings", label: "Settings", icon: Settings },
  { href: "/admin/audit", label: "Audit log", icon: ScrollText },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <PortalShell title="Admin" nav={NAV}>{children}</PortalShell>;
}
