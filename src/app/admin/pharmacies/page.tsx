"use client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { patch } from "@/lib/api";
import { EntityTable, money, status, type Row } from "@/components/admin/entity-table";
import { Button, ErrorState, Input } from "@/components/ui";

export default function AdminPharmacies() {
  const qc = useQueryClient();
  const [target, setTarget] = useState<string>();
  const [note, setNote] = useState("");
  const m = useMutation({
    mutationFn: (v: { id: string; status: string; note?: string }) => patch(`/api/admin/partners/pharmacies/${v.id}`, { status: v.status, note: v.note }),
    onSuccess: () => { setTarget(undefined); setNote(""); qc.invalidateQueries({ queryKey: ["admin", "pharmacies"] }); qc.invalidateQueries({ queryKey: ["admin-stats"] }); },
  });
  return (
    <>
      <EntityTable title="Pharmacies" subtitle="All partner pharmacies. Suspending a pharmacy stops it from receiving orders immediately." queryKey="pharmacies" url="/api/admin/partners/pharmacies"
        columns={[{ key: "name", label: "Pharmacy", className: "font-semibold" }, { key: "drugLicense", label: "Drug licence" }, { key: "pincode", label: "Pincode" }, { key: "verification", label: "Status", render: status },
          { key: "orders", label: "Orders" }, { key: "revenue", label: "Revenue", render: money }, { key: "stockLines", label: "Stock lines" }, { key: "rating", label: "Rating" }]}
        rowAction={(r: Row) => r.verification === "VERIFIED"
          ? <Button variant="secondary" className="min-h-10 py-1" onClick={() => setTarget(String(r.id))}>Suspend…</Button>
          : r.verification === "SUSPENDED" ? <Button className="min-h-10 py-1" loading={m.isPending && m.variables?.id === r.id} onClick={() => m.mutate({ id: String(r.id), status: "VERIFIED" })}>Reactivate</Button> : null} />
      {target && (
        <div className="mt-4 max-w-md space-y-2 rounded-2xl border border-line bg-white p-4"><Input label="Reason for suspension" value={note} onChange={(e) => setNote(e.target.value)} />
          <div className="flex gap-2"><Button variant="danger" disabled={note.trim().length < 3} loading={m.isPending} onClick={() => m.mutate({ id: target, status: "SUSPENDED", note })}>Suspend</Button><Button variant="ghost" onClick={() => setTarget(undefined)}>Cancel</Button></div></div>
      )}
      {m.isError && <div className="mt-3"><ErrorState message={(m.error as Error).message} /></div>}
    </>
  );
}
