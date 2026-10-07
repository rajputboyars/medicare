"use client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { patch } from "@/lib/api";
import { EntityTable, money, status, when, type Row } from "@/components/admin/entity-table";
import { Badge, Button, ErrorState } from "@/components/ui";

export default function AdminRiders() {
  const qc = useQueryClient();
  const m = useMutation({
    mutationFn: (v: { id: string; status: string; note?: string }) => patch(`/api/admin/partners/riders/${v.id}`, v),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin", "riders"] }); qc.invalidateQueries({ queryKey: ["admin-stats"] }); },
  });
  return (
    <>
      <EntityTable title="Riders" subtitle="Delivery partners, their status and earnings." queryKey="riders" url="/api/admin/partners/riders"
        columns={[{ key: "name", label: "Rider", className: "font-semibold" }, { key: "mobile", label: "Mobile" }, { key: "vehicle", label: "Vehicle" }, { key: "verification", label: "Verification", render: status },
          { key: "available", label: "Now", render: (v) => <Badge tone={v ? "green" : "gray"}>{v ? "online" : "offline"}</Badge> }, { key: "deliveries", label: "Deliveries" }, { key: "earned", label: "Earned", render: money }, { key: "joinedAt", label: "Joined", render: when }]}
        rowAction={(r: Row) => r.verification === "VERIFIED"
          ? <Button variant="secondary" className="min-h-10 py-1" onClick={() => m.mutate({ id: String(r.id), status: "SUSPENDED", note: "Suspended by admin" })}>Suspend</Button>
          : r.verification === "SUSPENDED" ? <Button className="min-h-10 py-1" onClick={() => m.mutate({ id: String(r.id), status: "VERIFIED" })}>Reactivate</Button> : null} />
      {m.isError && <div className="mt-3"><ErrorState message={(m.error as Error).message} /></div>}
    </>
  );
}
