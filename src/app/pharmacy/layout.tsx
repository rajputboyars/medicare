"use client";
import { ClipboardList, FileCheck2, IndianRupee, LayoutDashboard, LineChart, PackageSearch, Search, Settings, Users } from "lucide-react";
import { PortalShell } from "@/components/layout/portal-shell";

const NAV = [
  { href: "/pharmacy", label: "Dashboard", icon: LayoutDashboard, exact: true },
  { href: "/pharmacy/orders", label: "Orders", icon: ClipboardList },
  { href: "/pharmacy/prescriptions", label: "Prescription Verification", icon: FileCheck2 },
  { href: "/pharmacy/requests", label: "Medicine Requests", icon: Search },
  { href: "/pharmacy/inventory", label: "Inventory", icon: PackageSearch },
  { href: "/pharmacy/customers", label: "Customers", icon: Users },
  { href: "/pharmacy/payments", label: "Payments", icon: IndianRupee },
  { href: "/pharmacy/reports", label: "Reports", icon: LineChart },
  { href: "/pharmacy/settings", label: "Settings", icon: Settings },
];

export default function PharmacyLayout({ children }: { children: React.ReactNode }) {
  return <PortalShell title="Pharmacy Portal" nav={NAV}>{children}</PortalShell>;
}
