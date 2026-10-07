"use client";
import { EntityTable, status, when } from "@/components/admin/entity-table";

export default function AdminRequests() {
  return (
    <EntityTable title="Medicine Requests" subtitle="Customers asking “Find This Medicine For Me”, and how pharmacies replied." queryKey="requests" url="/api/admin/list/requests"
      columns={[{ key: "medicineQuery", label: "Medicine", className: "font-semibold" }, { key: "pincode", label: "Pincode" }, { key: "status", label: "Status", render: status }, { key: "responses", label: "Replies" }, { key: "available", label: "Say available" }, { key: "createdAt", label: "Asked", render: when }]} />
  );
}
