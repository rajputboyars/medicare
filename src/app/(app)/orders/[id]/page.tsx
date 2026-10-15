"use client";
import { Suspense, use, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText, Phone, Printer, Star } from "lucide-react";
import { api, post } from "@/lib/api";
import { fmtDateTime, SUPPORT_PHONE } from "@/lib/hooks";
import { inr } from "@/lib/pricing";
import { isFinal } from "@/lib/order-machine";
import { describeStatus } from "@/lib/order-copy";
import { OrderStatusBadge } from "@/components/order/order-status-badge";
import { OrderStatusTimeline } from "@/components/order/order-status-timeline";
import { Badge, Button, Card, ConfirmationDialog, ErrorState, LinkButton, Notice, PageTitle, QueryBoundary, Select, SectionHeader, SkeletonList, Success } from "@/components/ui";
import { CANCEL_REASON_LABEL, CUSTOMER_CANCEL_REASONS } from "@/lib/cancel-reasons";
import type { CancelReasonCode, Order } from "@/lib/types";

interface PaymentInfo { id: string; status: string; method: string; amount: number; refundStatus?: string }
type O = Order & { deliveryOtp?: string; pickupOtp?: string; canCancel?: boolean; cancelNeedsApproval?: boolean; codAvailable?: boolean; payment?: PaymentInfo; tracking?: { kmAway?: number }; delivery?: { status: string }; pharmacy?: { id: string; name: string; mobile: string; address: string }; rider?: { name: string; mobile: string; vehicle: string } };

function Detail({ id }: { id: string }) {
  const qc = useQueryClient();
  const router = useRouter();
  const placed = useSearchParams().get("placed");
  const q = useQuery({ queryKey: ["order", id], queryFn: () => api<O>(`/api/orders/${id}`), refetchInterval: (query) => (query.state.data && isFinal(query.state.data.status) ? false : 10_000) });
  const [reason, setReason] = useState<CancelReasonCode>("ORDERED_BY_MISTAKE");
  const [stars, setStars] = useState(5);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [fileErr, setFileErr] = useState<string>();

  const act = useMutation({
    mutationFn: (body: Record<string, unknown>) => post<O>(`/api/orders/${id}`, body),
    onSuccess: () => { setConfirmCancel(false); qc.invalidateQueries({ queryKey: ["order", id] }); qc.invalidateQueries({ queryKey: ["orders"] }); },
  });

  /** Payment buttons never mark anything paid: the gateway tells our server, and this page just refreshes. */
  const payAct = useMutation({
    mutationFn: (a: { kind: "pay" | "retry" | "cod"; paymentId?: string }) =>
      a.kind === "pay" ? post("/api/payments/" + a.paymentId + "/mock-complete", { outcome: "success" })
        : post("/api/orders/" + id + "/payment/retry", a.kind === "cod" ? { method: "COD" } : {}),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["order", id] }); qc.invalidateQueries({ queryKey: ["orders"] }); },
  });
  const decide = useMutation({
    mutationFn: (decision: "CONTINUE" | "CANCEL") => post("/api/orders/" + id + "/partial-fulfillment", { decision }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["order", id] }); qc.invalidateQueries({ queryKey: ["orders"] }); },
  });

  async function openRx(rxId: string) {
    setFileErr(undefined);
    try { const r = await api<{ url: string }>(`/api/prescriptions/${rxId}`); window.open(r.url, "_blank", "noopener"); } catch (e) { setFileErr((e as Error).message); }
  }

  return (
    <QueryBoundary query={q} skeleton={<SkeletonList rows={4} lines={4} />}>
      {(o) => {
        const final = isFinal(o.status);
        const last = o.statusHistory.at(-1);
        const online = o.paymentMethod !== "COD";
        const needsPay = online && (o.paymentStatus === "PENDING" || o.paymentStatus === "FAILED") && o.status !== "CANCELLED";
        const pf = o.partialFulfillment?.status === "PENDING_CUSTOMER" ? o.partialFulfillment : undefined;
        const [etaLo, etaHi] = o.etaRange ?? [o.etaMinutes, Math.round(o.etaMinutes * 1.4)];
        const refundText = o.refundStatus === "COMPLETED" ? "Your refund is complete." : o.refundStatus === "FAILED" ? "Your refund is delayed. Our team is fixing it and you do not need to do anything." : o.refundStatus === "NOT_REQUIRED" ? "" : "Your refund is on its way. It usually reaches you in 5 to 7 working days.";
        const needsBetterRx = o.status === "PRESCRIPTION_REVIEW" && last?.note?.startsWith("Clearer prescription needed");
        const sentence = describeStatus(o.status, { pharmacy: o.pharmacy?.name, rider: o.rider?.name.split(" ")[0], note: o.cancelReason ?? last?.note });
        return (
          <>
            <PageTitle back={{ href: "/orders", label: "My orders" }} title={`Order ${o.code}`} subtitle={`${fmtDateTime(o.createdAt)} · ${o.pharmacy?.name ?? ""}`} />
            {placed && <div className="mb-4"><Success title="Order placed">{o.items.some((i) => i.prescriptionRequired) ? "The pharmacist will check your prescription first. We will tell you as soon as it is approved." : `${o.pharmacy?.name} will confirm shortly.`}</Success></div>}

            {/* What is happening right now, in a sentence */}
            <Card className={o.status === "CANCELLED" ? "mb-4 border-emergency-line bg-emergency-50" : final ? "mb-4 border-ok-line bg-ok-50" : "mb-4 border-brand-200 bg-brand-50"} aria-live="polite">
              <div className="mb-2"><OrderStatusBadge status={o.status} /></div>
              <p className="t-section">{sentence}</p>
              {!final && <p className="t-support mt-1">Estimated delivery: about <b className="text-ink">{etaLo}–{etaHi} minutes</b>. It depends on stock, the prescription check and delivery partner availability.{o.deliveryType === "PRIORITY" && <> <Badge tone="blue">Priority</Badge></>}</p>}
              {refundText && <p className="t-support mt-1 text-ink">{refundText}</p>}
              {o.tracking?.kmAway !== undefined && <p className="t-support mt-1">Your delivery partner is about <b className="text-ink">{o.tracking.kmAway} km</b> away.</p>}
            </Card>

            {needsBetterRx && (
              <div className="mb-4"><Notice tone="amber" title="The pharmacist needs a clearer prescription">{last?.note?.replace("Clearer prescription needed: ", "")}
                <div className="mt-3"><LinkButton href={`/upload-prescription?order=${o.id}`}>Upload a clearer prescription</LinkButton></div></Notice></div>
            )}
            {pf && (
              <div className="mb-4"><Notice tone="amber" title="Some medicines are not available">
                <ul className="mt-1 list-disc pl-5">{pf.unavailable.map((u) => <li key={u.itemId}>{u.name} ×{u.quantity}: {u.reason}</li>)}</ul>
                <p className="mt-2">If you continue, your order will be <b>{inr(pf.proposed.total)}</b> for the other medicines.{o.paymentMethod !== "COD" && o.total > pf.proposed.total ? " We will refund " + inr(o.total - pf.proposed.total) + "." : ""}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button size="lg" loading={decide.isPending && decide.variables === "CONTINUE"} onClick={() => decide.mutate("CONTINUE")}>Continue with the rest</Button>
                  <Button size="lg" variant="danger-outline" loading={decide.isPending && decide.variables === "CANCEL"} onClick={() => decide.mutate("CANCEL")}>Cancel the whole order</Button>
                </div>
                {decide.isError && <p role="alert" className="mt-2 font-semibold text-emergency">{(decide.error as Error).message}</p>}
              </Notice></div>
            )}
            {o.cancellationRequest?.status === "PENDING" && <div className="mb-4"><Notice tone="blue" title="Waiting for the pharmacy">You asked to cancel. The pharmacy has already started on this order, so they will answer shortly.</Notice></div>}
            {o.delivery?.status && ["DELIVERY_FAILED", "RETURNING_TO_PHARMACY", "RETURNED_TO_PHARMACY"].includes(o.delivery.status) && <div className="mb-4"><Notice tone="amber" title="We could not deliver your order">Our team will call you to try again or bring it back and refund you. You do not need to do anything.</Notice></div>}
            {needsPay && o.payment && (
              <div className="mb-4"><Notice tone={o.paymentStatus === "FAILED" ? "amber" : "blue"} title={o.paymentStatus === "FAILED" ? "Your payment did not go through" : "Pay " + inr(o.total) + " by " + o.paymentMethod}>
                {o.paymentStatus === "FAILED" ? "You can try again, pay cash on delivery, or cancel the order." : "This is a demo payment screen. With a real gateway, your payment app opens here."}
                <div className="mt-3 flex flex-wrap gap-2">
                  {o.paymentStatus === "FAILED"
                    ? <Button size="lg" loading={payAct.isPending && payAct.variables?.kind === "retry"} onClick={() => payAct.mutate({ kind: "retry" })}>Try payment again</Button>
                    : <Button size="lg" loading={payAct.isPending && payAct.variables?.kind === "pay"} onClick={() => payAct.mutate({ kind: "pay", paymentId: o.payment!.id })}>Pay {inr(o.total)} securely</Button>}
                  {o.codAvailable && <Button size="lg" variant="secondary" loading={payAct.isPending && payAct.variables?.kind === "cod"} onClick={() => payAct.mutate({ kind: "cod" })}>Pay cash on delivery instead</Button>}
                </div>
                {payAct.isError && <p role="alert" className="mt-2 font-semibold text-emergency">{(payAct.error as Error).message}</p>}
              </Notice></div>
            )}
            {act.isError && !confirmCancel && <div className="mb-4"><ErrorState message={(act.error as Error).message} /></div>}

            {o.rider && (
              <Card className="mb-4 space-y-3" aria-label="Delivery partner">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div><p className="t-caption">Your delivery partner</p><p className="t-section">{o.rider.name}</p><p className="t-support">{o.rider.vehicle}</p></div>
                  <a href={`tel:${o.rider.mobile}`} className="tap inline-flex items-center gap-2 rounded-control bg-brand-600 px-5 font-semibold text-white hover:bg-brand-700"><Phone className="size-5" aria-hidden /> Call {o.rider.name.split(" ")[0]}</a>
                </div>
                {o.deliveryOtp && (
                  <div className="rounded-card border-2 border-dashed border-brand-600 p-3 text-center">
                    <p className="t-support">Tell this code to the delivery partner only when you receive your medicines</p>
                    <p className="t-number text-4xl tracking-[0.4em]" aria-label={`Delivery code ${o.deliveryOtp.split("").join(" ")}`}>{o.deliveryOtp}</p>
                  </div>
                )}
              </Card>
            )}

            <Card as="section" aria-labelledby="tl" className="mb-4"><SectionHeader id="tl" title="Order progress" />
              <OrderStatusTimeline order={o} pharmacy={o.pharmacy?.name} rider={o.rider?.name} />
            </Card>

            <Card as="section" aria-labelledby="its" className="mb-4"><SectionHeader id="its" title="Your medicines" />
              <ul className="divide-y divide-line">{o.items.map((i) => <li key={i.id} className="flex justify-between gap-3 py-2.5"><span>{i.name} <span className="t-caption">({i.strength}) ×{i.quantity}</span></span><b>{inr(i.unitPrice * i.quantity)}</b></li>)}</ul>
              <dl className="mt-3 space-y-1.5 border-t border-line pt-3">
                <div className="flex justify-between"><dt>Medicines</dt><dd>{inr(o.subtotal)}</dd></div>
                <div className="flex justify-between"><dt>Delivery</dt><dd>{o.deliveryFee ? inr(o.deliveryFee) : "Free"}</dd></div>
                <div className="flex justify-between"><dt>Other fees</dt><dd>{o.platformFee ? inr(o.platformFee) : "₹0"}</dd></div>
                {o.discount > 0 && <div className="flex justify-between text-ok"><dt>Offer</dt><dd>−{inr(o.discount)}</dd></div>}
                <div className="flex justify-between border-t border-line pt-2"><dt className="t-section">Total</dt><dd className="t-number text-xl">{inr(o.total)}</dd></div>
                <div className="flex justify-between t-caption"><dt>Payment</dt><dd>{o.paymentMethod === "COD" ? "Cash on delivery" : o.paymentMethod} · {o.paymentStatus === "PAID" ? "paid" : o.paymentMethod === "COD" && o.paymentStatus === "PENDING" ? "pay on delivery" : o.paymentStatus.replace("_", " ").toLowerCase()}</dd></div>
              </dl>
              <p className="t-support mt-3">Delivering to: {o.addressSnapshot.houseDescription}, {o.addressSnapshot.area}, {o.addressSnapshot.town} – {o.addressSnapshot.pincode}. Landmark: {o.addressSnapshot.landmark}</p>
            </Card>

            <div className="flex flex-wrap gap-2">
              {o.prescriptionId && <Button variant="secondary" onClick={() => openRx(o.prescriptionId!)}><FileText className="size-5" aria-hidden /> View prescription</Button>}
              <LinkButton href={`/orders/${o.id}/invoice`} variant="secondary"><Printer className="size-5" aria-hidden /> Invoice</LinkButton>
              {o.pharmacy && <a href={`tel:${o.pharmacy.mobile}`} className="tap inline-flex items-center gap-2 rounded-control border-2 border-line-strong px-5 font-semibold hover:bg-surface-2"><Phone className="size-5" aria-hidden /> Call pharmacy</a>}
              <a href={`tel:${SUPPORT_PHONE}`} className="tap inline-flex items-center rounded-control border-2 border-line-strong px-5 font-semibold hover:bg-surface-2">Help</a>
            </div>
            {fileErr && <p role="alert" className="mt-2 text-sm font-semibold text-emergency">{fileErr}</p>}

            {final && (
              <Card className="mt-4"><h2 className="t-section mb-1">Order again</h2>
                <p className="t-support mb-3">{o.items.some((i) => i.prescriptionRequired) ? "Prescription medicines go to the pharmacist again." : "Same medicines, same pharmacy, same address."}</p>
                <div className="flex flex-wrap gap-2">
                  <Button loading={act.isPending && act.variables?.action === "repeat"} onClick={() => act.mutateAsync({ action: "repeat" }).then((n) => { router.push(`/orders/${n.id}?placed=1`); })}>Repeat Order</Button>
                  {o.status === "DELIVERED" && <Button variant="secondary" loading={act.isPending && act.variables?.action === "save_medicines"} onClick={() => act.mutate({ action: "save_medicines", everyDays: 30 })}>Save to my medicines</Button>}
                </div>
                {act.isSuccess && act.variables?.action === "save_medicines" && <p role="status" className="mt-2 text-sm font-semibold text-ok">Saved. We will remind you before the next refill. <Link href="/repeat" className="underline">See saved medicines</Link></p>}
              </Card>
            )}
            {o.status === "DELIVERED" && (
              <Card className="mt-4"><h2 className="t-section mb-2">Rate this pharmacy</h2>
                <div className="mb-3 flex gap-1" role="radiogroup" aria-label="Rating">{[1, 2, 3, 4, 5].map((n) => <button key={n} role="radio" aria-checked={stars === n} aria-label={`${n} star${n > 1 ? "s" : ""}`} onClick={() => setStars(n)} className="tap grid place-items-center"><Star className={`size-8 ${n <= stars ? "fill-amber-400 text-amber-500" : "text-line-strong"}`} /></button>)}</div>
                <Button variant="secondary" loading={act.isPending && act.variables?.action === "review"} onClick={() => act.mutate({ action: "review", rating: stars })}>Send rating</Button>
                {act.isSuccess && act.variables?.action === "review" && <p role="status" className="mt-2 text-sm font-semibold text-ok">Thank you for your rating.</p>}</Card>
            )}

            {o.canCancel && o.cancellationRequest?.status !== "PENDING" && (
              <div className="mt-4 text-center"><Button variant="danger-outline" onClick={() => setConfirmCancel(true)}>{o.cancelNeedsApproval ? "Ask to cancel this order" : "Cancel this order"}</Button>
                <p className="t-caption mt-2">{o.cancelNeedsApproval ? "The pharmacy has started on your order, so they need to agree." : "Free until the pharmacy starts preparing it."}</p></div>
            )}
            <ConfirmationDialog open={confirmCancel} onClose={() => setConfirmCancel(false)} tone="danger" title="Cancel this order?"
              description="If you already paid online, the money comes back to you." confirmLabel="Yes, cancel order" cancelLabel="No, keep it"
              loading={act.isPending && act.variables?.action === "cancel"} error={act.isError ? (act.error as Error).message : undefined}
              onConfirm={() => act.mutate({ action: "cancel", reasonCode: reason })}>
              <Select label="Why are you cancelling?" value={reason} onChange={(e) => setReason(e.target.value as CancelReasonCode)}>{CUSTOMER_CANCEL_REASONS.map((r) => <option key={r} value={r}>{CANCEL_REASON_LABEL[r]}</option>)}</Select>
            </ConfirmationDialog>
          </>
        );
      }}
    </QueryBoundary>
  );
}

export default function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <Suspense fallback={<SkeletonList rows={4} lines={4} />}><Detail id={id} /></Suspense>;
}
