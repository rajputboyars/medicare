"use client";
import { Suspense, use, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Circle, FileText, Phone, Printer, Star } from "lucide-react";
import { api, post } from "@/lib/api";
import { fmtDateTime, SUPPORT_PHONE } from "@/lib/hooks";
import { inr } from "@/lib/pricing";
import { STATUS_LABEL, isFinal, statusTone, timeline } from "@/lib/order-machine";
import { Badge, Button, Card, ErrorState, LinkButton, Notice, QueryBoundary, Select, SkeletonList, Success } from "@/components/ui";
import type { Order } from "@/lib/types";

type O = Order & { canCancel?: boolean; pharmacy?: { id: string; name: string; mobile: string; address: string }; rider?: { name: string; mobile: string; vehicle: string } };

function Detail({ id }: { id: string }) {
  const qc = useQueryClient();
  const router = useRouter();
  const placed = useSearchParams().get("placed");
  const q = useQuery({ queryKey: ["order", id], queryFn: () => api<O>(`/api/orders/${id}`), refetchInterval: (query) => (query.state.data && isFinal(query.state.data.status) ? false : 10_000) });
  const [reason, setReason] = useState("Ordered by mistake");
  const [stars, setStars] = useState(5);
  const [fileErr, setFileErr] = useState<string>();

  const act = useMutation({
    mutationFn: (body: Record<string, unknown>) => post<O>(`/api/orders/${id}`, body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["order", id] }); qc.invalidateQueries({ queryKey: ["orders"] }); },
  });

  async function openRx(rxId: string) {
    setFileErr(undefined);
    try {
      const r = await api<{ url: string }>(`/api/prescriptions/${rxId}`);
      window.open(r.url, "_blank", "noopener");
    } catch (e) { setFileErr((e as Error).message); }
  }

  return (
    <QueryBoundary query={q} skeleton={<SkeletonList rows={4} height="h-28" />}>
      {(o) => {
        const steps = timeline(o);
        const needsPay = o.paymentStatus === "PENDING" && o.status !== "CANCELLED";
        const canCancel = !!o.canCancel;
        const lastNote = o.statusHistory.at(-1);
        const needsBetterRx = o.status === "PRESCRIPTION_REVIEW" && lastNote?.note?.startsWith("Clearer prescription needed");
        return (
          <>
            {placed && <div className="mb-4"><Success title="Order placed!">{o.items.some((i) => i.prescriptionRequired) ? "The pharmacist will now check your prescription. We will tell you as soon as it is approved." : `${o.pharmacy?.name} will confirm shortly.`}</Success></div>}
            <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
              <div><h1 className="text-2xl font-extrabold">Order {o.code}</h1><p className="text-muted">{fmtDateTime(o.createdAt)} · {o.pharmacy?.name}</p></div>
              <Badge tone={statusTone(o.status)} className="text-sm">{STATUS_LABEL[o.status]}</Badge>
            </div>

            {needsBetterRx && (
              <div className="mb-4"><Notice tone="amber" title="The pharmacist needs a clearer prescription">{lastNote?.note?.replace("Clearer prescription needed: ", "")}
                <LinkButton href={`/upload-prescription?order=${o.id}`} className="mt-3 w-full sm:w-auto">Upload a clearer prescription</LinkButton></Notice></div>
            )}
            {needsPay && (
              <div className="mb-4"><Notice tone="blue" title={`Pay ${inr(o.total)} by ${o.paymentMethod}`}>This is a demo payment gateway. In production, UPI/card opens your payment app.
                <Button className="mt-3 w-full sm:w-auto" loading={act.isPending} onClick={() => act.mutate({ action: "pay", providerRef: `demo_${Date.now()}` })}>Pay {inr(o.total)} securely</Button></Notice></div>
            )}
            {o.status === "CANCELLED" && <div className="mb-4"><Notice tone="red" title={o.cancelledBy === "CUSTOMER" ? "You cancelled this order" : "This order was cancelled"}>{o.cancelReason ?? lastNote?.note}{o.paymentStatus === "REFUNDED" && " Your payment will be refunded to the original method in 3–5 working days."}</Notice></div>}
            {act.isError && <div className="mb-4"><ErrorState message={(act.error as Error).message} /></div>}

            {!isFinal(o.status) && (
              <Card className="mb-4 flex flex-wrap items-center justify-between gap-3 bg-brand-50">
                <div><p className="text-sm text-muted">Estimated delivery</p><p className="text-xl font-extrabold">about {o.etaMinutes}–{Math.round(o.etaMinutes * 1.4)} min</p><p className="text-xs text-muted">Depends on stock, prescription check and rider availability.</p></div>
                {o.deliveryType === "PRIORITY" && <Badge tone="blue">Priority</Badge>}
              </Card>
            )}

            {o.rider && (
              <Card className="mb-4 space-y-3" aria-label="Delivery partner">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div><p className="text-sm text-muted">Your delivery partner</p><p className="text-lg font-bold">{o.rider.name}</p><p className="text-sm text-muted">{o.rider.vehicle}</p></div>
                  <a href={`tel:${o.rider.mobile}`} className="inline-flex min-h-12 items-center gap-2 rounded-2xl bg-brand-600 px-5 font-semibold text-white"><Phone className="size-5" aria-hidden /> Call {o.rider.name.split(" ")[0]}</a>
                </div>
                {o.deliveryOtp && <div className="rounded-2xl border-2 border-dashed border-brand-600 p-3 text-center"><p className="text-sm text-muted">Tell this code to the rider only when you receive your medicines</p><p className="text-4xl font-extrabold tracking-[0.4em]" aria-label={`Delivery code ${o.deliveryOtp.split("").join(" ")}`}>{o.deliveryOtp}</p></div>}
              </Card>
            )}

            <Card as="section" aria-labelledby="tl" className="mb-4">
              <h2 id="tl" className="mb-3 text-lg font-extrabold">Order progress</h2>
              <ol className="space-y-0">
                {steps.map((s, i) => (
                  <li key={s.status} aria-current={s.current ? "step" : undefined} className="flex gap-3">
                    <div className="flex flex-col items-center">
                      <span className={`grid size-7 place-items-center rounded-full ${s.done ? "bg-brand-600 text-white" : s.current ? "bg-brand-100 text-brand-700 ring-2 ring-brand-600" : "bg-stone-100 text-stone-400"}`}>{s.done ? <Check className="size-4" aria-hidden /> : <Circle className="size-3" aria-hidden />}</span>
                      {i < steps.length - 1 && <span className={`w-0.5 flex-1 ${s.done ? "bg-brand-600" : "bg-stone-200"}`} style={{ minHeight: 22 }} />}
                    </div>
                    <div className="pb-4"><p className={`font-semibold ${s.done || s.current ? "" : "text-muted"}`}>{s.label}<span className="sr-only">{s.done ? " (done)" : s.current ? " (current)" : " (pending)"}</span></p>{s.at && <p className="text-xs text-muted">{fmtDateTime(s.at)}</p>}</div>
                  </li>
                ))}
              </ol>
            </Card>

            <Card as="section" aria-labelledby="its" className="mb-4">
              <h2 id="its" className="mb-2 text-lg font-extrabold">Medicines</h2>
              <ul className="divide-y divide-line">{o.items.map((i) => <li key={i.id} className="flex justify-between gap-3 py-2"><span>{i.name} <span className="text-muted">({i.strength}) ×{i.quantity}</span></span><b>{inr(i.unitPrice * i.quantity)}</b></li>)}</ul>
              <dl className="mt-3 space-y-1 border-t border-line pt-3">
                <div className="flex justify-between"><dt>Items</dt><dd>{inr(o.subtotal)}</dd></div>
                <div className="flex justify-between"><dt>Delivery</dt><dd>{o.deliveryFee ? inr(o.deliveryFee) : "Free"}</dd></div>
                {o.discount > 0 && <div className="flex justify-between text-ok"><dt>Offer</dt><dd>−{inr(o.discount)}</dd></div>}
                <div className="flex justify-between text-lg font-extrabold"><dt>Total</dt><dd>{inr(o.total)}</dd></div>
                <div className="flex justify-between text-sm text-muted"><dt>Payment</dt><dd>{o.paymentMethod} · {o.paymentStatus.replace("_", " ").toLowerCase()}</dd></div>
              </dl>
              <p className="mt-3 text-sm text-muted">Deliver to: {o.addressSnapshot.houseDescription}, {o.addressSnapshot.area}, {o.addressSnapshot.town} – {o.addressSnapshot.pincode}. Landmark: {o.addressSnapshot.landmark}</p>
            </Card>

            <div className="flex flex-wrap gap-2">
              {o.prescriptionId && <Button variant="secondary" onClick={() => openRx(o.prescriptionId!)}><FileText className="size-5" aria-hidden /> View prescription</Button>}
              <Link href={`/orders/${o.id}/invoice`} className="inline-flex min-h-12 items-center gap-2 rounded-2xl border-2 border-brand-600 px-5 font-semibold text-brand-700"><Printer className="size-5" aria-hidden /> Invoice</Link>
              {o.pharmacy && <a href={`tel:${o.pharmacy.mobile}`} className="inline-flex min-h-12 items-center gap-2 rounded-2xl border-2 border-line px-5 font-semibold"><Phone className="size-5" aria-hidden /> Call pharmacy</a>}
              <a href={`tel:${SUPPORT_PHONE}`} className="inline-flex min-h-12 items-center gap-2 rounded-2xl border-2 border-line px-5 font-semibold">Help</a>
            </div>
            {fileErr && <p role="alert" className="mt-2 text-sm text-emergency">{fileErr}</p>}

            {isFinal(o.status) && (
              <Card className="mt-4"><h2 className="mb-2 text-lg font-extrabold">Order again</h2>
                <p className="mb-3 text-sm text-muted">{o.items.some((i) => i.prescriptionRequired) ? "Prescription medicines go through pharmacist review again." : "Same medicines, same pharmacy, same address."}</p>
                <div className="flex flex-wrap gap-2">
                  <Button loading={act.isPending && act.variables?.action === "repeat"} onClick={() => act.mutateAsync({ action: "repeat" }).then((n) => { router.push(`/orders/${n.id}?placed=1`); })}>Reorder in one tap</Button>
                  {o.status === "DELIVERED" && <Button variant="secondary" loading={act.isPending && act.variables?.action === "save_medicines"} onClick={() => act.mutate({ action: "save_medicines", everyDays: 30 })}>Save to my medicines</Button>}
                </div>
                {act.isSuccess && act.variables?.action === "save_medicines" && <p role="status" className="mt-2 text-sm font-semibold text-ok">Saved. We will remind you before the next refill. <Link href="/repeat" className="underline">See saved medicines</Link></p>}
              </Card>
            )}
            {o.status === "DELIVERED" && (
              <>
                <Card className="mt-4"><h2 className="mb-2 text-lg font-extrabold">Rate this pharmacy</h2>
                  <div className="mb-3 flex gap-1" role="radiogroup" aria-label="Rating">{[1, 2, 3, 4, 5].map((n) => <button key={n} role="radio" aria-checked={stars === n} aria-label={`${n} star${n > 1 ? "s" : ""}`} onClick={() => setStars(n)} className="grid size-12 place-items-center"><Star className={`size-8 ${n <= stars ? "fill-amber-400 text-amber-500" : "text-stone-300"}`} /></button>)}</div>
                  <Button variant="secondary" loading={act.isPending} onClick={() => act.mutate({ action: "review", rating: stars })}>Submit review</Button></Card>
              </>
            )}

            {canCancel && (
              <Card className="mt-4"><h2 className="mb-2 text-lg font-extrabold">Cancel order</h2>
                <p className="mb-3 text-sm text-muted">Free before the rider picks up. Paid orders are refunded in 3–5 working days.</p>
                <div className="flex flex-wrap items-end gap-2"><div className="min-w-48 flex-1"><Select label="Reason" value={reason} onChange={(e) => setReason(e.target.value)}>{["Ordered by mistake", "Found it elsewhere", "Taking too long", "Wrong address", "Other"].map((r) => <option key={r}>{r}</option>)}</Select></div>
                  <Button variant="danger" loading={act.isPending} onClick={() => act.mutate({ action: "cancel", reason })}>Cancel order</Button></div></Card>
            )}
          </>
        );
      }}
    </QueryBoundary>
  );
}

export default function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <Suspense fallback={<SkeletonList rows={4} />}><Detail id={id} /></Suspense>;
}
