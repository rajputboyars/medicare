"use client";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, post } from "@/lib/api";
import { fmtDateTime } from "@/lib/hooks";
import { Badge, Button, Card, EmptyState, ErrorState, Input, PageTitle, QueryBoundary, SkeletonList } from "@/components/ui";

interface Req { id: string; medicineQuery: string; pincode: string; createdAt: string; status: string; myResponse?: { response: string; alternative?: string; restockEta?: string } }

function RequestCard({ r }: { r: Req }) {
  const qc = useQueryClient();
  const [alt, setAlt] = useState("");
  const [eta, setEta] = useState("");
  const reply = useMutation({ mutationFn: (response: string) => post(`/api/pharmacy/requests/${r.id}`, { response, alternative: alt || undefined, restockEta: eta || undefined }), onSuccess: () => qc.invalidateQueries({ queryKey: ["pharmacy-requests"] }) });
  return (
    <Card as="article" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2"><div><h3 className="text-lg font-bold">{r.medicineQuery}</h3><p className="text-sm text-muted">Pincode {r.pincode} · {fmtDateTime(r.createdAt)}</p></div>
        {r.myResponse ? <Badge tone="green">You replied: {r.myResponse.response.replace("_", " ").toLowerCase()}</Badge> : <Badge tone="amber">Needs reply</Badge>}</div>
      <div className="grid gap-3 sm:grid-cols-2"><Input label="Alternative (if any)" value={alt} onChange={(e) => setAlt(e.target.value)} /><Input label="Expected restock (if out of stock)" placeholder="e.g. 2 days" value={eta} onChange={(e) => setEta(e.target.value)} /></div>
      {reply.isError && <ErrorState message={(reply.error as Error).message} />}
      <div className="flex flex-wrap gap-2">
        <Button loading={reply.isPending && reply.variables === "AVAILABLE"} onClick={() => reply.mutate("AVAILABLE")}>We have it</Button>
        <Button variant="secondary" disabled={!alt.trim()} onClick={() => reply.mutate("ALTERNATIVE")}>Alternative available</Button>
        <Button variant="ghost" onClick={() => reply.mutate("OUT_OF_STOCK")}>Out of stock</Button>
      </div>
      <p className="text-xs text-muted">If you have it, add it to your inventory so the customer can order it.</p>
    </Card>
  );
}

export default function Requests() {
  const q = useQuery({ queryKey: ["pharmacy-requests"], queryFn: () => api<Req[]>("/api/pharmacy/requests"), refetchInterval: 20_000 });
  return (
    <>
      <PageTitle title="Medicine requests" subtitle="Customers nearby are looking for these. A fast reply wins the order." />
      <QueryBoundary query={q} skeleton={<SkeletonList rows={2} height="h-40" />} isEmpty={(d) => d.length === 0} empty={<EmptyState title="No requests right now" />}>
        {(list) => <div className="space-y-3">{list.map((r) => <RequestCard key={r.id} r={r} />)}</div>}
      </QueryBoundary>
    </>
  );
}
