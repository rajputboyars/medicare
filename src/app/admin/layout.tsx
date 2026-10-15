"use client";
import { useQuery } from "@tanstack/react-query";
import { BarChart3, Bike, ClipboardList, Coins, CreditCard, LayoutDashboard, LifeBuoy, LineChart, MapPinned, PackageSearch, Search, Settings, Store, Users } from "lucide-react";
import { api } from "@/lib/api";
import { PortalShell } from "@/components/layout/portal-shell";
import type { NavItem } from "@/components/layout/nav";

export interface AttentionItem { id: string; severity: "info" | "warning" | "critical"; title: string; description: string; href: string; actionLabel: string }
export interface AdminStats {
  ordersToday: number; gmv: number; customers: number; activePharmacies: number; ridersOnline: number; ridersVerified: number; liveOrders: number; openRequests: number; openTickets: number;
  pendingApprovals: number; pendingMatches: number; pendingPharmacyApprovals: number; pendingRiderApprovals: number; pendingSettlements: number; deliveries: number; cancelledOrders: number; attention: AttentionItem[];
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  // Same key as the dashboard so sidebar counts cost nothing extra.
  const s = useQuery({ queryKey: ["admin-stats"], queryFn: () => api<AdminStats>("/api/admin/stats"), refetchInterval: 30_000 }).data;
  const nav: NavItem[] = [
    { href: "/admin", label: "Dashboard", icon: LayoutDashboard, exact: true },
    { href: "/admin/customers", label: "Users", icon: Users },
    { href: "/admin/pharmacies", label: "Pharmacies", icon: Store, badge: s?.pendingPharmacyApprovals, also: ["/admin/verification"] },
    { href: "/admin/orders", label: "Orders", icon: ClipboardList },
    { href: "/admin/requests", label: "Medicine Requests", icon: Search, badge: s?.openRequests },
    { href: "/admin/riders", label: "Delivery Partners", icon: Bike, badge: s?.pendingRiderApprovals },
    { href: "/admin/medicine-matches", label: "Medicine Matches", icon: PackageSearch, badge: s?.pendingMatches },
    { href: "/admin/catalog-insights", label: "Search Insights", icon: BarChart3 },
    { href: "/admin/service-areas", label: "Service Areas", icon: MapPinned },
    { href: "/admin/payments", label: "Payments", icon: CreditCard },
    { href: "/admin/settlements", label: "Settlements", icon: Coins },
    { href: "/admin/complaints", label: "Complaints", icon: LifeBuoy, badge: s?.openTickets },
    { href: "/admin/reports", label: "Reports", icon: LineChart },
    { href: "/admin/settings", label: "Settings", icon: Settings, also: ["/admin/audit"] },
  ];
  return <PortalShell title="Admin" nav={nav}>{children}</PortalShell>;
}
