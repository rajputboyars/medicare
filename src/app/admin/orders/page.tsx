"use client";
import { EntityTable, money, status, when } from "@/components/admin/entity-table";
import { STATUS_LABEL } from "@/lib/order-machine";
import { Badge } from "@/components/ui";
import type { OrderStatus } from "@/lib/types";

export default function AdminOrders() {
  return (
    <EntityTable title="Orders" subtitle="Every order on the platform, newest first." queryKey="orders" url="/api/admin/list/orders"
      columns={[
        { key: "code", label: "Order", className: "font-semibold" },
        { key: "status", label: "Status", render: (v) => <Badge tone={v === "DELIVERED" ? "green" : v === "CANCELLED" ? "red" : "blue"}>{STATUS_LABEL[v as OrderStatus]}</Badge> },
        { key: "customer", label: "Customer" }, { key: "pharmacy", label: "Pharmacy" }, { key: "rider", label: "Rider" },
        { key: "total", label: "Total", render: money }, { key: "paymentStatus", label: "Payment", render: status },
        { key: "hasPrescription", label: "Rx", render: (v) => (v ? "Yes" : "") }, { key: "createdAt", label: "Placed", render: when },
      ]} />
  );
}
