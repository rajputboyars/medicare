"use client";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText, Phone } from "lucide-react";
import { api, post } from "@/lib/api";
import { fmtDateTime } from "@/lib/hooks";
import { inr } from "@/lib/pricing";
import { STATUS_LABEL, statusTone } from "@/lib/order-machine";
import { Badge, Button, Card, EmptyState, ErrorState, Input, Notice, QueryBoundary, SkeletonList } from "@/components/ui";
import type { OrderItem, OrderStatus, PrescriptionStatus } from "@/lib/types";

export interface PharmacyOrder {
  id: string; code: string; status: OrderStatus; items: OrderItem[]; total: number; deliveryType: string; paymentMethod: string; paymentStatus: string;
  createdAt: string; etaMinutes: number; pickupOtp?: string; area: string; note?: string;
  patient: { name: string; age?: number; allergies?: string };
  rider?: { name: string; mobile: string };
  prescription?: { id: string; status: PrescriptionStatus; mimeType: string; note?: string };
}

export const GROUPS = {
  review: ["PRESCRIPTION_REVIEW"],
  new: ["PENDING", "PRESCRIPTION_APPROVED"],
  progress: ["CONFIRMED", "PREPARING", "READY_FOR_PICKUP", "RIDER_ASSIGNED", "PICKED_UP", "OUT_FOR_DELIVERY"],
  history: ["DELIVERED", "CANCELLED"],
} as const;
export type Group = keyof typeof GROUPS;
const EMPTY: Record<Group, string> = { review: "No prescriptions waiting", new: "No new orders", progress: "Nothing in progress", history: "No history yet" };

export function useViewPrescription() {
  const [err, setErr] = useState<string>();
  async function view(id: string) {
    setErr(undefined);
    try { const r = await api<{ url: string }>(`/api/prescriptions/${id}`); window.open(r.url, "_blank", "noopener"); } catch (e) { setErr((e as Error).message); }
  }
  return { view, err };
}

export function OrderCard({ o }: { o: PharmacyOrder }) {
  const qc = useQueryClient();
  const [mode, setMode] = useState<"none" | "reject" | "clarify">("none");
  const [note, setNote] = useState("");
  const { view, err } = useViewPrescription();
  const refresh = () => ["pharmacy-orders", "pharmacy-dashboard", "pharmacy-rx"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
  const run = useMutation({
    mutationFn: (body: Record<string, unknown>) => post(`/api/pharmacy/orders/${o.id}`, body),
    onSuccess: () => { setMode("none"); setNote(""); refresh(); },
  });
  const step = (s: "confirm" | "prepare" | "ready") => run.mutate({ action: "step", step: s });
  const busy = run.isPending;

  return (
    <Card as="article" className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div><h3 className="text-lg font-extrabold">{o.code} <span className="text-sm font-normal text-muted">· {fmtDateTime(o.createdAt)}</span></h3>
          <p className="text-sm text-muted">Patient: {o.patient.name}{o.patient.age ? `, ${o.patient.age} yrs` : ""} · {o.area}</p></div>
        <div className="flex flex-wrap gap-2"><Badge tone={statusTone(o.status)}>{STATUS_LABEL[o.status]}</Badge>{o.deliveryType === "PRIORITY" && <Badge tone="red">Priority</Badge>}</div>
      </div>
      {o.patient.allergies && <Badge tone="red">Allergy: {o.patient.allergies}</Badge>}
      <ul className="divide-y divide-line text-sm">{o.items.map((i) => <li key={i.id} className="flex justify-between py-1.5"><span>{i.name} <span className="text-muted">{i.strength}</span> ×{i.quantity} {i.prescriptionRequired && <Badge tone="amber">Rx</Badge>}</span><b>{inr(i.unitPrice * i.quantity)}</b></li>)}</ul>
      <p className="flex justify-between font-bold"><span>{o.paymentMethod} · {o.paymentStatus.replace("_", " ").toLowerCase()}</span><span>{inr(o.total)}</span></p>

      {o.prescription && <div className="flex flex-wrap items-center gap-2"><Button variant="secondary" className="min-h-11" onClick={() => view(o.prescription!.id)}><FileText className="size-5" aria-hidden /> View prescription</Button><Badge tone={o.prescription.status === "APPROVED" ? "green" : "amber"}>{o.prescription.status.replace("_", " ").toLowerCase()}</Badge></div>}
      {err && <p role="alert" className="text-sm text-emergency">{err}</p>}

      {o.status === "PRESCRIPTION_REVIEW" && <Notice tone="amber">Check the doctor&apos;s details, date and every medicine against the order. We never substitute medicines. If something is unclear, ask for a clearer copy; if it is invalid, reject with a reason.</Notice>}
      {o.pickupOtp && <Notice tone="blue" title="Pickup code for the rider">Give this code to the delivery partner when they collect the parcel: <b className="text-2xl tracking-widest">{o.pickupOtp}</b></Notice>}
      {o.rider && <p className="flex flex-wrap items-center gap-2 text-sm"><b>Rider:</b> {o.rider.name} <a href={`tel:${o.rider.mobile}`} className="inline-flex min-h-10 items-center gap-1 font-semibold text-brand-700"><Phone className="size-4" aria-hidden /> Call</a></p>}
      {o.status === "CANCELLED" && o.note && <p className="text-sm text-muted">Reason: {o.note}</p>}
      {run.isError && <ErrorState message={(run.error as Error).message} />}

      {mode !== "none" ? (
        <div className="space-y-2">
          <Input label={mode === "reject" ? "Reason (shown to the customer)" : "What is unclear? (shown to the customer)"} value={note} onChange={(e) => setNote(e.target.value)} />
          <div className="flex flex-wrap gap-2">
            {mode === "reject" && <Button variant="danger" disabled={note.trim().length < 3} loading={busy} onClick={() => run.mutate(o.status === "PRESCRIPTION_REVIEW" ? { action: "review", decision: "REJECT", note } : { action: "reject", note })}>Confirm reject</Button>}
            {mode === "clarify" && <Button disabled={note.trim().length < 3} loading={busy} onClick={() => run.mutate({ action: "review", decision: "CLARIFY", note })}>Ask for a clearer copy</Button>}
            <Button variant="ghost" onClick={() => setMode("none")}>Back</Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {o.status === "PRESCRIPTION_REVIEW" && <><Button loading={busy} onClick={() => run.mutate({ action: "review", decision: "APPROVE" })}>Approve prescription</Button><Button variant="secondary" onClick={() => setMode("clarify")}>Need clearer copy</Button></>}
          {(o.status === "PENDING" || o.status === "PRESCRIPTION_APPROVED") && <Button loading={busy} onClick={() => step("confirm")}>Accept &amp; confirm order</Button>}
          {o.status === "CONFIRMED" && <Button loading={busy} onClick={() => step("prepare")}>Start preparing</Button>}
          {o.status === "PREPARING" && <Button loading={busy} onClick={() => step("ready")}>Mark ready for pickup</Button>}
          {o.status === "READY_FOR_PICKUP" && <><Button loading={busy} onClick={() => run.mutate({ action: "assign" })}>Assign nearest rider</Button><p className="self-center text-sm text-muted">Or wait: riders can accept it from their app.</p></>}
          {["PRESCRIPTION_REVIEW", "PENDING", "PRESCRIPTION_APPROVED", "CONFIRMED", "PREPARING", "READY_FOR_PICKUP", "RIDER_ASSIGNED"].includes(o.status) && <Button variant="secondary" onClick={() => setMode("reject")}>Reject / cancel…</Button>}
        </div>
      )}
    </Card>
  );
}

export function usePharmacyOrders() {
  return useQuery({ queryKey: ["pharmacy-orders"], queryFn: () => api<PharmacyOrder[]>("/api/pharmacy/orders"), refetchInterval: 15_000 });
}

export function OrderQueue({ group, limit }: { group: Group; limit?: number }) {
  const q = usePharmacyOrders();
  const inGroup = (o: PharmacyOrder) => (GROUPS[group] as readonly string[]).includes(o.status);
  return (
    <QueryBoundary query={q} skeleton={<SkeletonList rows={2} height="h-48" />} isEmpty={(d) => d.filter(inGroup).length === 0}
      empty={<EmptyState title={EMPTY[group]} body={group === "new" ? "New orders appear here automatically." : undefined} />}>
      {(list) => <div className="space-y-3">{list.filter(inGroup).slice(0, limit).map((o) => <OrderCard key={o.id} o={o} />)}</div>}
    </QueryBoundary>
  );
}
