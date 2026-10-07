"use client";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MapPin, Navigation, Phone, Store } from "lucide-react";
import { api, post } from "@/lib/api";
import { fmtDateTime } from "@/lib/hooks";
import { inr } from "@/lib/pricing";
import { useRiderMe } from "@/components/delivery/rider-context";
import { Badge, Button, Card, EmptyState, ErrorState, Input, Notice, QueryBoundary, SkeletonList, Stat } from "@/components/ui";
import type { GeoPoint, OrderStatus } from "@/lib/types";

interface Available { id: string; code: string; deliveryType: string; parcelCount: number; pharmacy: { name: string; address: string }; toPharmacyKm?: number; dropKm?: number; dropArea: string; payout: number; collectCash: number; readyAt: string }
interface Active {
  id: string; code: string; status: OrderStatus; deliveryType: string; parcelCount: number; collectCash: number; payout: number; etaMinutes: number;
  pharmacy: { name: string; address: string; mobile: string; location: GeoPoint };
  customer: { name: string; mobile: string; address: string; landmark: string; location?: GeoPoint };
}

const nav = (p?: GeoPoint) => (p ? `https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}` : undefined);
const refreshAll = (qc: ReturnType<typeof useQueryClient>) => ["rider-available", "rider-active", "rider-me", "rider-history", "rider-earnings"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));

function ActiveJob({ o }: { o: Active }) {
  const qc = useQueryClient();
  const [otp, setOtp] = useState("");
  const step = useMutation({
    mutationFn: (b: { action: string; otp?: string }) => post(`/api/delivery/orders/${o.id}`, b),
    onSuccess: () => { setOtp(""); refreshAll(qc); },
  });
  const toPickup = o.status === "RIDER_ASSIGNED";
  const label = toPickup ? "Go to pharmacy" : o.status === "PICKED_UP" ? "Picked up" : "Out for delivery";
  return (
    <Card as="article" className="space-y-3">
      <div className="flex items-start justify-between gap-2"><div><h3 className="text-lg font-extrabold">{o.code}</h3><p className="text-sm text-muted">{o.parcelCount} parcel{o.parcelCount === 1 ? "" : "s"} · earn {inr(o.payout)}</p></div>
        <div className="flex flex-col items-end gap-1"><Badge tone="blue">{label}</Badge>{o.deliveryType === "PRIORITY" && <Badge tone="red">Priority</Badge>}</div></div>

      <section aria-label="Pickup" className={`rounded-2xl border-2 p-3 ${toPickup ? "border-brand-600" : "border-line opacity-70"}`}>
        <p className="flex items-center gap-2 font-bold"><Store className="size-5 text-brand-600" aria-hidden /> Pickup: {o.pharmacy.name}</p><p className="text-sm text-muted">{o.pharmacy.address}</p>
        <div className="mt-2 grid grid-cols-2 gap-2"><a href={`tel:${o.pharmacy.mobile}`} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl border-2 border-line font-semibold"><Phone className="size-5" aria-hidden /> Call pharmacy</a>
          <a href={nav(o.pharmacy.location)} target="_blank" rel="noreferrer" className="inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-brand-50 font-semibold text-brand-800"><Navigation className="size-5" aria-hidden /> Navigate</a></div>
        {toPickup && (
          <div className="mt-3 space-y-2">
            <Input label="Pickup code from the pharmacy" inputMode="numeric" maxLength={4} value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))} />
            <Button className="w-full" disabled={otp.length !== 4} loading={step.isPending} onClick={() => step.mutate({ action: "pickup", otp })}>Confirm pickup</Button>
            <Button variant="ghost" className="w-full" onClick={() => step.mutate({ action: "drop" })}>I can&apos;t do this delivery</Button>
          </div>
        )}
      </section>

      <section aria-label="Delivery" className={`rounded-2xl border-2 p-3 ${!toPickup ? "border-brand-600" : "border-line opacity-70"}`}>
        <p className="flex items-center gap-2 font-bold"><MapPin className="size-5 text-brand-600" aria-hidden /> Deliver to {o.customer.name}</p>
        <p className="text-sm">{o.customer.address}</p><p className="text-sm font-semibold">Landmark: {o.customer.landmark}</p>
        <div className="mt-2 grid grid-cols-2 gap-2"><a href={`tel:${o.customer.mobile}`} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl border-2 border-line font-semibold"><Phone className="size-5" aria-hidden /> Call customer</a>
          {nav(o.customer.location) ? <a href={nav(o.customer.location)} target="_blank" rel="noreferrer" className="inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-brand-50 font-semibold text-brand-800"><Navigation className="size-5" aria-hidden /> Navigate</a> : <span className="grid place-items-center text-sm text-muted">No map pin. Use the landmark.</span>}</div>
        {o.collectCash > 0 && <div className="mt-3"><Notice tone="amber" title={`Collect cash ${inr(o.collectCash)}`}>Cash on delivery. Collect the exact amount.</Notice></div>}
        {!toPickup && (
          <div className="mt-3 space-y-2">
            {o.status === "PICKED_UP" && <Button className="w-full" loading={step.isPending} onClick={() => step.mutate({ action: "start" })}>Start delivery</Button>}
            {o.status === "OUT_FOR_DELIVERY" && (
              <>
                <Input label="Delivery code from the customer" inputMode="numeric" maxLength={4} value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))} />
                <Button className="w-full" disabled={otp.length !== 4} loading={step.isPending} onClick={() => step.mutate({ action: "deliver", otp })}>Complete delivery</Button>
              </>
            )}
          </div>
        )}
      </section>
      {step.isError && <ErrorState message={(step.error as Error).message} />}
      <p className="text-xs text-muted">Medicine details are hidden for customer privacy. Handle the parcel carefully and never open it.</p>
    </Card>
  );
}

function AvailableCard({ j }: { j: Available }) {
  const qc = useQueryClient();
  const accept = useMutation({ mutationFn: () => post(`/api/delivery/orders/${j.id}`, { action: "accept" }), onSettled: () => refreshAll(qc) });
  return (
    <Card as="article" className="space-y-2">
      <div className="flex items-start justify-between gap-2"><div><h3 className="text-lg font-extrabold">{j.code}</h3><p className="text-sm text-muted">Ready {fmtDateTime(j.readyAt)} · {j.parcelCount} parcel{j.parcelCount === 1 ? "" : "s"}</p></div><p className="text-xl font-extrabold text-ok">{inr(j.payout)}</p></div>
      <p className="flex items-start gap-2 text-sm"><Store className="mt-0.5 size-4 shrink-0 text-brand-600" aria-hidden /> <span><b>{j.pharmacy.name}</b>{j.toPharmacyKm !== undefined ? ` · ${j.toPharmacyKm} km from you` : ""}<br /><span className="text-muted">{j.pharmacy.address}</span></span></p>
      <p className="flex items-start gap-2 text-sm"><MapPin className="mt-0.5 size-4 shrink-0 text-brand-600" aria-hidden /> <span>Drop: {j.dropArea}{j.dropKm !== undefined ? ` · ${j.dropKm} km` : ""}</span></p>
      <div className="flex flex-wrap gap-2">{j.deliveryType === "PRIORITY" && <Badge tone="red">Priority</Badge>}{j.collectCash > 0 && <Badge tone="amber">Collect {inr(j.collectCash)} cash</Badge>}</div>
      {accept.isError && <ErrorState message={(accept.error as Error).message} />}
      <Button className="w-full" loading={accept.isPending} onClick={() => accept.mutate()}>Accept delivery</Button>
    </Card>
  );
}

export default function DeliveryHome() {
  const me = useRiderMe();
  const active = useQuery({ queryKey: ["rider-active"], queryFn: () => api<Active[]>("/api/delivery/active"), refetchInterval: 10_000 });
  const available = useQuery({ queryKey: ["rider-available"], queryFn: () => api<Available[]>("/api/delivery/available"), refetchInterval: 10_000, enabled: !!me.data?.available });
  return (
    <>
      <div className="mb-4 grid grid-cols-2 gap-3"><Stat label="Earned today" value={me.data ? inr(me.data.earningsToday) : "–"} /><Stat label="Deliveries today" value={me.data?.deliveriesToday ?? "–"} /></div>

      <h2 className="mb-3 text-xl font-extrabold">My active deliveries</h2>
      <QueryBoundary query={active} skeleton={<SkeletonList rows={1} height="h-64" />} isEmpty={(d) => d.length === 0} empty={<EmptyState title="No active delivery" body="Accept one from the list below." />}>
        {(list) => <div className="space-y-3">{list.map((o) => <ActiveJob key={o.id} o={o} />)}</div>}
      </QueryBoundary>

      <h2 className="mb-3 mt-8 text-xl font-extrabold">Available deliveries</h2>
      {!me.data?.available ? (
        <EmptyState title="You are offline" body="Switch to Online at the top to see deliveries near you." />
      ) : (
        <QueryBoundary query={available} skeleton={<SkeletonList rows={2} height="h-40" />} isEmpty={(d) => d.length === 0} empty={<EmptyState title="No deliveries right now" body="New orders appear here when pharmacies mark them ready. This list refreshes by itself." />}>
          {(list) => <div className="space-y-3">{list.map((j) => <AvailableCard key={j.id} j={j} />)}</div>}
        </QueryBoundary>
      )}
    </>
  );
}
