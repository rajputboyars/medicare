"use client";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText, Phone } from "lucide-react";
import { api, post } from "@/lib/api";
import { fmtDateTime } from "@/lib/hooks";
import { OrderCard, usePharmacyOrders, useViewPrescription } from "@/components/pharmacy/order-queue";
import { Badge, Button, Card, EmptyState, ErrorState, Input, Notice, PageTitle, QueryBoundary, SkeletonList } from "@/components/ui";

interface Callback { kind: "CALLBACK"; prescriptionId: string; createdAt: string; callbackMobile?: string; status: string }
interface Queue { callbacks: Callback[] }

function CallbackCard({ c }: { c: Callback }) {
  const qc = useQueryClient();
  const { view, err } = useViewPrescription();
  const [note, setNote] = useState("");
  const [mode, setMode] = useState<"none" | "reject">("none");
  const run = useMutation({
    mutationFn: (decision: "APPROVE" | "REJECT") => post(`/api/pharmacy/prescriptions/${c.prescriptionId}`, { decision, note: note || undefined }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["pharmacy-rx"] }),
  });
  return (
    <Card as="article" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-extrabold">Call-me prescription <span className="text-sm font-normal text-muted">· {fmtDateTime(c.createdAt)}</span></h3><Badge tone="amber">Needs a call</Badge></div>
      <p className="text-sm text-muted">The customer sent this without an account. Call them, confirm the medicines and delivery details, and invite them to place the order in the app. Mark it verified once you have checked the prescription.</p>
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" className="min-h-11" onClick={() => view(c.prescriptionId)}><FileText className="size-5" aria-hidden /> View prescription</Button>
        {c.callbackMobile && <a href={`tel:${c.callbackMobile}`} className="inline-flex min-h-11 items-center gap-2 rounded-2xl bg-brand-600 px-5 font-semibold text-white"><Phone className="size-5" aria-hidden /> Call {c.callbackMobile}</a>}
      </div>
      {err && <p role="alert" className="text-sm text-emergency">{err}</p>}
      {run.isError && <ErrorState message={(run.error as Error).message} />}
      {mode === "reject" ? (
        <div className="space-y-2"><Input label="Reason" value={note} onChange={(e) => setNote(e.target.value)} />
          <div className="flex gap-2"><Button variant="danger" disabled={note.trim().length < 3} loading={run.isPending} onClick={() => run.mutate("REJECT")}>Reject</Button><Button variant="ghost" onClick={() => setMode("none")}>Back</Button></div></div>
      ) : (
        <div className="flex gap-2"><Button loading={run.isPending} onClick={() => run.mutate("APPROVE")}>Verified</Button><Button variant="secondary" onClick={() => setMode("reject")}>Cannot verify…</Button></div>
      )}
    </Card>
  );
}

export default function PrescriptionVerification() {
  const orders = usePharmacyOrders();
  const q = useQuery({ queryKey: ["pharmacy-rx"], queryFn: () => api<Queue>("/api/pharmacy/prescriptions"), refetchInterval: 20_000 });
  const review = orders.data?.filter((o) => o.status === "PRESCRIPTION_REVIEW");
  return (
    <>
      <PageTitle title="Prescription Verification" subtitle="Every prescription medicine order needs your approval before it is prepared." />
      <div className="mb-4"><Notice tone="blue">Open the prescription and check: doctor name and registration, date, patient, each medicine and strength. Never change or replace medicines on your own.</Notice></div>

      <section aria-labelledby="ord"><h2 id="ord" className="mb-3 text-xl font-extrabold">Orders waiting for review</h2>
        <QueryBoundary query={orders} skeleton={<SkeletonList rows={2} height="h-48" />} isEmpty={() => !review?.length} empty={<EmptyState title="No prescriptions waiting" body="New prescription orders appear here automatically." />}>
          {() => <div className="space-y-3">{review!.map((o) => <OrderCard key={o.id} o={o} />)}</div>}
        </QueryBoundary>
      </section>

      <section aria-labelledby="cb" className="mt-8"><h2 id="cb" className="mb-3 text-xl font-extrabold">“Call me” prescriptions</h2>
        <QueryBoundary query={q} skeleton={<SkeletonList rows={1} height="h-40" />} isEmpty={(d) => d.callbacks.length === 0} empty={<EmptyState title="No callbacks waiting" />}>
          {(d) => <div className="space-y-3">{d.callbacks.map((c) => <CallbackCard key={c.prescriptionId} c={c} />)}</div>}
        </QueryBoundary>
      </section>
    </>
  );
}
