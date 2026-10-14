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
import type { Order } from "@/lib/types";

type O = Order & { canCancel?: boolean; pharmacy?: { id: string; name: string; mobile: string; address: string }; rider?: { name: string; mobile: string; vehicle: string } };

function Detail({ id }: { id: string }) {
  const qc = useQueryClient();
  const router = useRouter();
  const placed = useSearchParams().get("placed");
  const q = useQuery({ queryKey: ["order", id], queryFn: () => api<O>(`/api/orders/${id}`), refetchInterval: (query) => (query.state.data && isFinal(query.state.data.status) ? false : 10_000) });
  const [reason, setReason] = useState("Ordered by mistake");
  const [stars, setStars] = useState(5);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [fileErr, setFileErr] = useState<string>();

  const act = useMutation({
    mutationFn: (body: Record<string, unknown>) => post<O>(`/api/orders/${id}`, body),
    onSuccess: () => { setConfirmCancel(false); qc.invalidateQueries({ queryKey: ["order", id] }); qc.invalidateQueries({ queryKey: ["orders"] }); },
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
        const needsPay = o.paymentStatus === "PENDING" && o.status !== "CANCELLED";
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
              {!final && <p className="t-support mt-1">Estimated delivery: about <b className="text-ink">{o.etaMinutes}–{Math.round(o.etaMinutes * 1.4)} minutes</b>. It depends on stock, the prescription check and delivery partner availability.{o.deliveryType === "PRIORITY" && <> <Badge tone="blue">Priority</Badge></>}</p>}
              {o.status === "CANCELLED" && o.paymentStatus === "REFUNDED" && <p className="t-support mt-1 text-ink">Your payment will be refunded to the original method in 3–5 working days.</p>}
            </Card>

            {needsBetterRx && (
              <div className="mb-4"><Notice tone="amber" title="The pharmacist needs a clearer prescription">{last?.note?.replace("Clearer prescription needed: ", "")}
                <div className="mt-3"><LinkButton href={`/upload-prescription?order=${o.id}`}>Upload a clearer prescription</LinkButton></div></Notice></div>
            )}
            {needsPay && (
              <div className="mb-4"><Notice tone="blue" title={`Pay ${inr(o.total)} by ${o.paymentMethod}`}>This is a demo payment screen. With a real gateway, your payment app opens here.
                <div className="mt-3"><Button size="lg" loading={act.isPending && act.variables?.action === "pay"} onClick={() => act.mutate({ action: "pay", providerRef: `demo_${Date.now()}` })}>Pay {inr(o.total)} securely</Button></div></Notice></div>
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
                <div className="flex justify-between"><dt>Other fees</dt><dd>₹0</dd></div>
                {o.discount > 0 && <div className="flex justify-between text-ok"><dt>Offer</dt><dd>−{inr(o.discount)}</dd></div>}
                <div className="flex justify-between border-t border-line pt-2"><dt className="t-section">Total</dt><dd className="t-number text-xl">{inr(o.total)}</dd></div>
                <div className="flex justify-between t-caption"><dt>Payment</dt><dd>{o.paymentMethod === "COD" ? "Cash on delivery" : o.paymentMethod} · {o.paymentStatus === "PAID" ? "paid" : o.paymentStatus === "COD_DUE" ? "pay on delivery" : o.paymentStatus.replace("_", " ").toLowerCase()}</dd></div>
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

            {o.canCancel && (
              <div className="mt-4 text-center"><Button variant="danger-outline" onClick={() => setConfirmCancel(true)}>Cancel this order</Button>
                <p className="t-caption mt-2">Free until the delivery partner picks it up.</p></div>
            )}
            <ConfirmationDialog open={confirmCancel} onClose={() => setConfirmCancel(false)} tone="danger" title="Cancel this order?"
              description="If you already paid online, the money comes back in 3–5 working days." confirmLabel="Yes, cancel order" cancelLabel="No, keep it"
              loading={act.isPending && act.variables?.action === "cancel"} error={act.isError ? (act.error as Error).message : undefined}
              onConfirm={() => act.mutate({ action: "cancel", reason })}>
              <Select label="Why are you cancelling?" value={reason} onChange={(e) => setReason(e.target.value)}>{["Ordered by mistake", "Found it elsewhere", "Taking too long", "Wrong address", "Other"].map((r) => <option key={r}>{r}</option>)}</Select>
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
