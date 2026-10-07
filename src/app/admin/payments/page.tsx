"use client";
import { EntityTable, money, status, when } from "@/components/admin/entity-table";

export default function AdminPayments() {
  return (
    <EntityTable title="Payments" subtitle="Online payments, cash on delivery and refunds." queryKey="payments" url="/api/admin/list/payments"
      columns={[{ key: "orderCode", label: "Order", className: "font-semibold" }, { key: "method", label: "Method" }, { key: "provider", label: "Provider" }, { key: "amount", label: "Amount", render: money }, { key: "status", label: "Status", render: status }, { key: "providerRef", label: "Reference" }, { key: "createdAt", label: "When", render: when }]} />
  );
}
