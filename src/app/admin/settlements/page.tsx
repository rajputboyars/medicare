"use client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { patch, post } from "@/lib/api";
import { fmtDate } from "@/lib/hooks";
import { EntityTable, money, status, type Row } from "@/components/admin/entity-table";
import { Button, ErrorState } from "@/components/ui";

const NEXT: Record<string, [string, string] | undefined> = { PENDING: ["PROCESSING", "Start payout"], PROCESSING: ["PAID", "Mark paid"] };

export default function AdminSettlements() {
  const qc = useQueryClient();
  const refresh = () => { qc.invalidateQueries({ queryKey: ["admin", "settlements"] }); qc.invalidateQueries({ queryKey: ["admin-stats"] }); };
  const gen = useMutation({ mutationFn: () => post<{ created: number }>("/api/admin/settlements", {}), onSuccess: refresh });
  const step = useMutation({ mutationFn: (v: { id: string; status: string }) => patch(`/api/admin/settlements/${v.id}`, { status: v.status }), onSuccess: refresh });
  return (
    <>
      <EntityTable title="Settlements" subtitle="Pharmacy payouts after commission. Generate creates one pending settlement per pharmacy for delivered orders not yet settled." queryKey="settlements" url="/api/admin/list/settlements"
        headerAction={<Button loading={gen.isPending} onClick={() => gen.mutate()}>Generate settlements</Button>}
        columns={[{ key: "partner", label: "Partner", className: "font-semibold" }, { key: "partnerType", label: "Type" }, { key: "periodEnd", label: "Period", render: (_v, r) => `${fmtDate(String(r.periodStart))} – ${fmtDate(String(r.periodEnd))}` }, { key: "orderCount", label: "Orders" }, { key: "gross", label: "Gross", render: money }, { key: "commission", label: "Commission", render: money }, { key: "net", label: "Net payout", render: money }, { key: "status", label: "Status", render: status }]}
        rowAction={(r: Row) => { const n = NEXT[String(r.status)]; return n ? <Button className="min-h-10 py-1" loading={step.isPending && step.variables?.id === r.id} onClick={() => step.mutate({ id: String(r.id), status: n[0] })}>{n[1]}</Button> : null; }} />
      {gen.isSuccess && <p role="status" className="mt-3 font-semibold text-ok">{gen.data.created ? `${gen.data.created} settlement(s) created.` : "Everything delivered is already settled."}</p>}
      {(gen.isError || step.isError) && <div className="mt-3"><ErrorState message={((gen.error ?? step.error) as Error).message} /></div>}
    </>
  );
}
