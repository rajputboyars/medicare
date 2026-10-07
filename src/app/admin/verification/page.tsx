"use client";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, patch } from "@/lib/api";
import { Badge, Button, Card, EmptyState, ErrorState, Input, PageTitle, QueryBoundary, SkeletonList } from "@/components/ui";

interface P { id: string; name: string; verification: "PENDING" | "VERIFIED" | "REJECTED" | "SUSPENDED"; drugLicense?: string; gstin?: string; ownerName?: string; address?: string; servicePincodes?: string[]; mobile?: string; vehicle?: string }
const tone = { PENDING: "amber", VERIFIED: "green", REJECTED: "red", SUSPENDED: "red" } as const;

function Row({ kind, p }: { kind: string; p: P }) {
  const qc = useQueryClient();
  const [note, setNote] = useState("");
  const [reject, setReject] = useState(false);
  const set = useMutation({
    mutationFn: (status: string) => patch(`/api/admin/partners/${kind}/${p.id}`, { status, note: note || undefined }),
    onSuccess: () => { setReject(false); setNote(""); qc.invalidateQueries({ queryKey: ["partners", kind] }); qc.invalidateQueries({ queryKey: ["admin-stats"] }); },
  });
  return (
    <Card as="li" className="space-y-2">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div><p className="font-bold">{p.name}</p>
          {kind === "pharmacies" ? <p className="text-sm text-muted">Drug licence {p.drugLicense}{p.gstin ? ` · GSTIN ${p.gstin}` : ""} · Owner {p.ownerName}<br />{p.address} · delivers to {p.servicePincodes?.join(", ")}</p> : <p className="text-sm text-muted">{p.mobile} · {p.vehicle}</p>}</div>
        <Badge tone={tone[p.verification]}>{p.verification.toLowerCase()}</Badge>
      </div>
      {kind === "pharmacies" && p.verification === "PENDING" && <p className="rounded-xl bg-warn-50 p-2 text-sm text-warn">Check the drug licence number against the state drug-control records and confirm a registered pharmacist before verifying.</p>}
      {reject ? <div className="space-y-2"><Input label="Reason (sent to the applicant)" value={note} onChange={(e) => setNote(e.target.value)} /><div className="flex gap-2"><Button variant="danger" disabled={note.trim().length < 3} loading={set.isPending} onClick={() => set.mutate("REJECTED")}>Reject</Button><Button variant="ghost" onClick={() => setReject(false)}>Back</Button></div></div> : (
        <div className="flex flex-wrap gap-2">
          {p.verification !== "VERIFIED" && <Button className="min-h-11" loading={set.isPending} onClick={() => set.mutate("VERIFIED")}>Verify</Button>}
          {p.verification === "PENDING" && <Button variant="secondary" className="min-h-11" onClick={() => setReject(true)}>Reject…</Button>}
        </div>)}
      {set.isError && <ErrorState message={(set.error as Error).message} />}
    </Card>
  );
}

export default function Verification() {
  const [kind, setKind] = useState<"pharmacies" | "riders">("pharmacies");
  const q = useQuery({ queryKey: ["partners", kind], queryFn: () => api<P[]>(`/api/admin/partners/${kind}`) });
  return (
    <>
      <PageTitle title="Verification queue" subtitle="Check licences and identity before activating a partner. Every decision is audit-logged." />
      <div className="mb-4 flex gap-2" role="tablist">{([["pharmacies", "Pharmacies"], ["riders", "Riders"]] as const).map(([k, l]) => <button key={k} role="tab" aria-selected={kind === k} onClick={() => setKind(k)} className={`min-h-12 rounded-2xl px-5 font-semibold ${kind === k ? "bg-brand-600 text-white" : "border border-line bg-white"}`}>{l}</button>)}</div>
      <QueryBoundary query={q} skeleton={<SkeletonList rows={3} height="h-28" />} isEmpty={(d) => d.length === 0} empty={<EmptyState title="Nothing here" />}>
        {(list) => <ul className="space-y-3">{[...list].sort((a, b) => Number(b.verification === "PENDING") - Number(a.verification === "PENDING")).map((p) => <Row key={p.id} kind={kind} p={p} />)}</ul>}
      </QueryBoundary>
    </>
  );
}
