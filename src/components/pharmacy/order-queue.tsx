"use client";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Clock, FileText, Phone } from "lucide-react";
import { api, post } from "@/lib/api";
import { fmtDateTime, useNow } from "@/lib/hooks";
import { inr } from "@/lib/pricing";
import { OrderStatusBadge } from "@/components/order/order-status-badge";
import { Badge, Button, Card, ConfirmationDialog, EmptyState, Input, Notice, QueryBoundary, SkeletonList, StatusBadge } from "@/components/ui";
import type { OrderItem, OrderStatus, PrescriptionStatus } from "@/lib/types";

export interface PharmacyOrder {
  id: string; code: string; status: OrderStatus; items: OrderItem[]; total: number; deliveryType: string; paymentMethod: string; paymentStatus: string;
  createdAt: string; etaMinutes: number; pickupOtp?: string; pickupOtpExpiresAt?: string; area: string; note?: string; refundStatus?: string;
  cancellationRequest?: { reasonCode: string; note?: string; requestedAt: string };
  partialFulfillment?: { status: string; unavailable: { itemId: string; name: string; reason: string }[] };
  delivery?: { status: string; failureReasonCode?: string };
  patient: { name: string; age?: number; allergies?: string };
  rider?: { name: string; mobile: string };
  prescription?: { id: string; status: PrescriptionStatus; mimeType: string; note?: string };
}

export const GROUPS = {
  review: ["PRESCRIPTION_REVIEW"],
  new: ["PENDING", "PRESCRIPTION_APPROVED"],
  progress: ["CONFIRMED", "PREPARING", "READY_FOR_PICKUP", "RIDER_ASSIGNED", "PICKED_UP", "OUT_FOR_DELIVERY"],
  ready: ["READY_FOR_PICKUP", "RIDER_ASSIGNED"],
  history: ["DELIVERED", "CANCELLED"],
} as const;
export type Group = keyof typeof GROUPS;
const EMPTY: Record<Group, [string, string]> = {
  review: ["No prescriptions waiting", "New prescription orders appear here automatically."],
  new: ["No new orders", "New orders appear here automatically."],
  progress: ["Nothing in progress", "Orders you have confirmed show here until they are delivered."],
  ready: ["Nothing waiting for a rider", "Orders you mark ready appear here."],
  history: ["No history yet", "Delivered and cancelled orders appear here."],
};

export function useViewPrescription() {
  const [err, setErr] = useState<string>();
  async function view(id: string) {
    setErr(undefined);
    try { const r = await api<{ url: string }>(`/api/prescriptions/${id}`); window.open(r.url, "_blank", "noopener"); } catch (e) { setErr((e as Error).message); }
  }
  return { view, err };
}

type Dialog = "reject" | "clarify" | "partial" | "decline" | null;

/**
 * One order, with the next obvious action as the big button.
 * Destructive actions (reject / cancel) always ask first and need a reason that the customer will see.
 */
export function OrderCard({ o }: { o: PharmacyOrder }) {
  const qc = useQueryClient();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [note, setNote] = useState("");
  const { view, err } = useViewPrescription();
  const refresh = () => ["pharmacy-orders", "pharmacy-dashboard", "pharmacy-rx"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
  const run = useMutation({
    mutationFn: (body: Record<string, unknown>) => post(`/api/pharmacy/orders/${o.id}`, body),
    onSuccess: () => { setDialog(null); setNote(""); refresh(); },
  });
  const step = (s: "confirm" | "prepare" | "ready") => run.mutate({ action: "step", step: s });
  const now = useNow();
  const waitingMin = Math.round((now - Date.parse(o.createdAt)) / 60_000);
  const urgent = ["PENDING", "PRESCRIPTION_REVIEW"].includes(o.status) && waitingMin > 15;
  const cancellable = ["PRESCRIPTION_REVIEW", "PENDING", "PRESCRIPTION_APPROVED", "CONFIRMED", "PREPARING", "READY_FOR_PICKUP", "RIDER_ASSIGNED"].includes(o.status);
  const closeDialog = () => { setDialog(null); setNote(""); setMissing([]); run.reset(); };
  const [missing, setMissing] = useState<string[]>([]);
  const act = useMutation({
    mutationFn: (a: { path: string; body?: Record<string, unknown> }) => post("/api/pharmacy/orders/" + o.id + "/" + a.path, a.body ?? {}),
    onSuccess: () => { closeDialog(); refresh(); },
  });
  const prepaidOk = o.paymentMethod === "COD" || o.paymentStatus === "PAID";
  const canPartial = ["PENDING", "PRESCRIPTION_APPROVED", "CONFIRMED", "PREPARING"].includes(o.status) && o.items.length > 1 && prepaidOk && o.partialFulfillment?.status !== "PENDING_CUSTOMER";
  const waitingCustomer = o.partialFulfillment?.status === "PENDING_CUSTOMER";
  const returning = o.delivery?.status === "RETURNING_TO_PHARMACY";

  return (
    <Card as="article" className={urgent ? "space-y-3 border-warn-line" : "space-y-3"}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="t-card">{o.code} <span className="t-caption font-normal">· {fmtDateTime(o.createdAt)}</span></h3>
          <p className="t-support">Patient: {o.patient.name}{o.patient.age ? `, ${o.patient.age} yrs` : ""} · {o.area}</p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5"><OrderStatusBadge status={o.status} />{o.deliveryType === "PRIORITY" && <StatusBadge tone="danger" icon={<AlertTriangle className="size-3.5" aria-hidden />}>Priority</StatusBadge>}</div>
      </div>
      {urgent && <p className="flex items-center gap-1.5 text-sm font-bold text-warn"><Clock className="size-4" aria-hidden /> Waiting {waitingMin} minutes. Please answer soon.</p>}
      {o.patient.allergies && <StatusBadge tone="danger" icon={<AlertTriangle className="size-3.5" aria-hidden />}>Allergy: {o.patient.allergies}</StatusBadge>}

      <ul className="divide-y divide-line text-sm">{o.items.map((i) => <li key={i.id} className="flex justify-between gap-3 py-2"><span>{i.name} <span className="t-caption">{i.strength}</span> ×{i.quantity} {i.prescriptionRequired && <Badge tone="amber">Rx</Badge>}</span><b>{inr(i.unitPrice * i.quantity)}</b></li>)}</ul>
      <p className="flex justify-between font-bold"><span>{o.paymentMethod === "COD" ? "Cash on delivery" : o.paymentMethod} · {o.paymentStatus === "PAID" ? "paid" : o.paymentMethod === "COD" && o.paymentStatus === "PENDING" ? "to collect" : o.paymentStatus.replace("_", " ").toLowerCase()}</span><span>{inr(o.total)}</span></p>

      {o.prescription && (
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" size="sm" className="min-h-11" onClick={() => view(o.prescription!.id)}><FileText className="size-4" aria-hidden /> View prescription</Button>
          <StatusBadge tone={o.prescription.status === "APPROVED" ? "success" : "warning"}>{o.prescription.status.replace("_", " ").toLowerCase()}</StatusBadge>
        </div>
      )}
      {err && <p role="alert" className="text-sm font-semibold text-emergency">{err}</p>}

      {o.status === "PRESCRIPTION_REVIEW" && <Notice tone="amber">Check the doctor&apos;s name, date and every medicine against the order. Never swap a medicine on your own. If it is unclear, ask for a clearer copy.</Notice>}
      {o.pickupOtp && <Notice tone="blue" title="Pickup code for the delivery partner">Give this code when they collect the parcel: <b className="text-2xl tracking-widest">{o.pickupOtp}</b>
        <div className="mt-2"><Button size="sm" variant="secondary" className="min-h-11" loading={act.isPending && act.variables?.path === "pickup-code"} onClick={() => act.mutate({ path: "pickup-code" })}>Get a new code</Button></div></Notice>}
      {waitingCustomer && <Notice tone="amber" title="Waiting for the customer">You marked {o.partialFulfillment!.unavailable.map((u) => u.name).join(", ")} as not available. The order cannot move on until the customer answers.</Notice>}
      {o.cancellationRequest && (
        <Notice tone="red" title="The customer wants to cancel">Reason: {o.cancellationRequest.reasonCode.replaceAll("_", " ").toLowerCase()}{o.cancellationRequest.note ? " – " + o.cancellationRequest.note : ""}
          <div className="mt-2 flex flex-wrap gap-2">
            <Button size="sm" className="min-h-11" loading={act.isPending && act.variables?.body?.decision === "APPROVE"} onClick={() => act.mutate({ path: "cancellation", body: { decision: "APPROVE" } })}>Allow cancel</Button>
            <Button size="sm" variant="secondary" className="min-h-11" onClick={() => setDialog("decline")}>Keep the order</Button>
          </div></Notice>
      )}
      {o.delivery && ["DELIVERY_FAILED", "RETURNING_TO_PHARMACY", "RETURNED_TO_PHARMACY"].includes(o.delivery.status) && (
        <Notice tone="amber" title={returning ? "A parcel is coming back" : o.delivery.status === "RETURNED_TO_PHARMACY" ? "Parcel is back" : "Delivery failed"}>
          {returning ? "Please check the parcel and confirm when the delivery partner hands it back." : o.delivery.status === "RETURNED_TO_PHARMACY" ? "Support will cancel the order and refund the customer." : "Support is deciding whether to try again or bring it back."}
          {returning && <div className="mt-2"><Button size="sm" className="min-h-11" loading={act.isPending && act.variables?.path === "return-received"} onClick={() => act.mutate({ path: "return-received" })}>Parcel received back</Button></div>}
        </Notice>
      )}
      {o.rider && <p className="flex flex-wrap items-center gap-2 text-sm"><b>Delivery partner:</b> {o.rider.name} <a href={`tel:${o.rider.mobile}`} className="tap inline-flex items-center gap-1 font-semibold text-brand-700"><Phone className="size-4" aria-hidden /> Call</a></p>}
      {o.status === "CANCELLED" && o.note && <p className="t-support">Reason: {o.note}</p>}
      {run.isError && !dialog && <Notice tone="red">{(run.error as Error).message}</Notice>}

      <div className="flex flex-wrap gap-2">
        {o.status === "PRESCRIPTION_REVIEW" && <><Button loading={run.isPending && run.variables?.decision === "APPROVE"} onClick={() => run.mutate({ action: "review", decision: "APPROVE" })}>Approve</Button><Button variant="secondary" onClick={() => setDialog("clarify")}>Need clarification</Button></>}
        {(o.status === "PENDING" || o.status === "PRESCRIPTION_APPROVED") && <Button loading={run.isPending} onClick={() => step("confirm")}>Accept order</Button>}
        {o.status === "CONFIRMED" && <Button loading={run.isPending} onClick={() => step("prepare")}>Start preparing</Button>}
        {o.status === "PREPARING" && <Button loading={run.isPending} onClick={() => step("ready")}>Ready for pickup</Button>}
        {o.status === "READY_FOR_PICKUP" && <><Button loading={run.isPending} onClick={() => run.mutate({ action: "assign" })}>Find a delivery partner</Button><p className="t-caption self-center">Or wait: partners can accept it in their app.</p></>}
        {canPartial && <Button variant="secondary" onClick={() => setDialog("partial")}>Some items not available</Button>}
        {cancellable && <Button variant="danger-outline" onClick={() => setDialog("reject")}>{o.status === "PRESCRIPTION_REVIEW" || o.status === "PENDING" ? "Reject" : "Cancel order"}</Button>}
      </div>

      <ConfirmationDialog open={dialog === "reject"} onClose={closeDialog} tone="danger"
        title={o.status === "PRESCRIPTION_REVIEW" || o.status === "PENDING" ? `Reject order ${o.code}?` : `Cancel order ${o.code}?`}
        description="The customer is told right away, and any online payment is refunded. This cannot be undone."
        confirmLabel={o.status === "PRESCRIPTION_REVIEW" || o.status === "PENDING" ? "Yes, reject" : "Yes, cancel order"} cancelLabel="Go back"
        confirmDisabled={note.trim().length < 3} loading={run.isPending} error={run.isError ? (run.error as Error).message : undefined}
        onConfirm={() => run.mutate(o.status === "PRESCRIPTION_REVIEW" ? { action: "review", decision: "REJECT", note } : { action: "reject", note })}>
        <Input label="Reason (the customer will read this)" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Out of stock today" />
      </ConfirmationDialog>
      <ConfirmationDialog open={dialog === "partial"} onClose={closeDialog} title="Which medicines can you not supply?"
        description="Tick them and say why. The customer chooses to continue with the rest or cancel. Nothing is removed until they answer."
        confirmLabel="Ask the customer" cancelLabel="Go back" confirmDisabled={missing.length === 0 || missing.length >= o.items.length || note.trim().length < 3} loading={act.isPending} error={act.isError ? (act.error as Error).message : undefined}
        onConfirm={() => act.mutate({ path: "partial-fulfillment", body: { items: missing.map((itemId) => ({ itemId, reason: note.trim() })) } })}>
        <ul className="mb-3 space-y-1">{o.items.map((i) => (
          <li key={i.id}><label className="tap flex items-center gap-3"><input type="checkbox" className="size-5" checked={missing.includes(i.id)} onChange={(e) => setMissing(e.target.checked ? [...missing, i.id] : missing.filter((x) => x !== i.id))} /> {i.name} <span className="t-caption">{i.strength} ×{i.quantity}</span></label></li>
        ))}</ul>
        {missing.length >= o.items.length && <p className="mb-2 text-sm font-semibold text-emergency">If you cannot supply anything, reject the order instead.</p>}
        <Input label="Reason (the customer will read this)" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Out of stock today" />
      </ConfirmationDialog>
      <ConfirmationDialog open={dialog === "decline"} onClose={closeDialog} title="Keep this order?"
        description="Tell the customer why it cannot be cancelled now." confirmLabel="Keep the order" cancelLabel="Go back"
        confirmDisabled={note.trim().length < 3} loading={act.isPending} error={act.isError ? (act.error as Error).message : undefined}
        onConfirm={() => act.mutate({ path: "cancellation", body: { decision: "REJECT", note } })}>
        <Input label="Reason (the customer will read this)" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Already packed" />
      </ConfirmationDialog>
      <ConfirmationDialog open={dialog === "clarify"} onClose={closeDialog} title="Ask for a clearer prescription"
        description="The customer gets a message and can upload a better photo. The order stays open."
        confirmLabel="Send request" cancelLabel="Go back" confirmDisabled={note.trim().length < 3} loading={run.isPending} error={run.isError ? (run.error as Error).message : undefined}
        onConfirm={() => run.mutate({ action: "review", decision: "CLARIFY", note })}>
        <Input label="What is unclear?" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. The doctor's signature is cut off" />
      </ConfirmationDialog>
    </Card>
  );
}

export function usePharmacyOrders() {
  return useQuery({ queryKey: ["pharmacy-orders"], queryFn: () => api<PharmacyOrder[]>("/api/pharmacy/orders"), refetchInterval: 15_000 });
}

export function OrderQueue({ group, limit }: { group: Group; limit?: number }) {
  const q = usePharmacyOrders();
  const inGroup = (o: PharmacyOrder) => (GROUPS[group] as readonly string[]).includes(o.status);
  const [title, body] = EMPTY[group];
  return (
    <QueryBoundary query={q} skeleton={<SkeletonList rows={2} lines={4} />} isEmpty={(d) => d.filter(inGroup).length === 0} empty={<EmptyState title={title} body={body} />}>
      {(list) => (
        <div className="grid gap-3 xl:grid-cols-2">
          {list.filter(inGroup).slice(0, limit).map((o) => <OrderCard key={o.id} o={o} />)}
        </div>
      )}
    </QueryBoundary>
  );
}

