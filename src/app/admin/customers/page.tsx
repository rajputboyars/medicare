"use client";
import { EntityTable, money, when } from "@/components/admin/entity-table";

export default function AdminCustomers() {
  return (
    <EntityTable title="Customers" subtitle="Accounts only: no prescriptions or health details are shown here." queryKey="customers" url="/api/admin/list/customers"
      columns={[{ key: "name", label: "Name", className: "font-semibold" }, { key: "mobile", label: "Mobile" }, { key: "email", label: "Email" }, { key: "orders", label: "Orders" }, { key: "spent", label: "Spent", render: money }, { key: "family", label: "Family profiles" }, { key: "joinedAt", label: "Joined", render: when }]} />
  );
}
