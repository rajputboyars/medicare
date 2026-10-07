"use client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { patch } from "@/lib/api";
import { EntityTable, status, when, type Row } from "@/components/admin/entity-table";
import { Button } from "@/components/ui";

export default function AdminComplaints() {
  const qc = useQueryClient();
  const m = useMutation({ mutationFn: (v: { id: string; status: string }) => patch(`/api/admin/tickets/${v.id}`, { status: v.status }), onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin", "complaints"] }); qc.invalidateQueries({ queryKey: ["admin-stats"] }); } });
  return (
    <EntityTable title="Complaints" subtitle="Support requests from customers." queryKey="complaints" url="/api/admin/list/complaints"
      columns={[{ key: "subject", label: "Subject", className: "font-semibold" }, { key: "message", label: "Message" }, { key: "customer", label: "Customer" }, { key: "orderCode", label: "Order" }, { key: "status", label: "Status", render: status }, { key: "createdAt", label: "Created", render: when }]}
      rowAction={(r: Row) => r.status === "RESOLVED" ? null : <Button className="min-h-10 py-1" loading={m.isPending && m.variables?.id === r.id} onClick={() => m.mutate({ id: String(r.id), status: r.status === "OPEN" ? "IN_PROGRESS" : "RESOLVED" })}>{r.status === "OPEN" ? "Start" : "Resolve"}</Button>} />
  );
}
