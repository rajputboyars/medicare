"use client";
import { useQuery } from "@tanstack/react-query";
import { ClipboardList, FileCheck2, IndianRupee, LayoutDashboard, LineChart, PackageSearch, Search, Settings, Users } from "lucide-react";
import { api } from "@/lib/api";
import { PortalShell } from "@/components/layout/portal-shell";
import type { NavItem } from "@/components/layout/nav";

export interface PharmacyStats {
  pharmacy: { name: string; drugLicense: string; verification: string; acceptingOrders: boolean };
  toReview: number; newOrders: number; inProgress: number; readyForPickup: number; deliveredToday: number; revenueToday: number; revenueTotal: number; lowStock: number; openRequests: number;
}

export default function PharmacyLayout({ children }: { children: React.ReactNode }) {
  // Same query key as the dashboard, so the sidebar counts are free and always match the cards.
  const stats = useQuery({ queryKey: ["pharmacy-dashboard"], queryFn: () => api<PharmacyStats>("/api/pharmacy/dashboard"), refetchInterval: 20_000 });
  const s = stats.data;
  const nav: NavItem[] = [
    { href: "/pharmacy", label: "Dashboard", icon: LayoutDashboard, exact: true },
    { href: "/pharmacy/orders", label: "Orders", icon: ClipboardList, badge: s?.newOrders },
    { href: "/pharmacy/requests", label: "Medicine Requests", icon: Search, badge: s?.openRequests },
    { href: "/pharmacy/prescriptions", label: "Prescriptions", icon: FileCheck2, badge: s?.toReview },
    { href: "/pharmacy/inventory", label: "Inventory", icon: PackageSearch },
    { href: "/pharmacy/customers", label: "Customers", icon: Users },
    { href: "/pharmacy/payments", label: "Payments", icon: IndianRupee },
    { href: "/pharmacy/reports", label: "Reports", icon: LineChart },
    { href: "/pharmacy/settings", label: "Settings", icon: Settings },
  ];
  return <PortalShell title="Pharmacy" nav={nav}>{children}</PortalShell>;
}
