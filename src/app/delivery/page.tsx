"use client";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, IndianRupee, MapPin, Navigation, PackageCheck, Phone, Power, Store, Truck } from "lucide-react";
import clsx from "clsx";
import { api, post } from "@/lib/api";
import { fmtDateTime } from "@/lib/hooks";
import { inr } from "@/lib/pricing";
import { useRiderMe, useToggleOnline } from "@/components/delivery/rider-context";
import { DeliveryStepper } from "@/components/delivery/delivery-stepper";
import { Button, Card, DashboardMetricCard, EmptyState, ErrorState, Input, Notice, QueryBoundary, SectionHeader, SkeletonList, StatusBadge } from "@/components/ui";
import type { GeoPoint, OrderStatus } from "@/lib/types";

interface Available { id: string; code: string; deliveryType: string; parcelCount: number; pharmacy: { name: string; address: string }; toPharmacyKm?: number; dropKm?: number; dropArea: string; payout: number; collectCash: number; readyAt: string }
interface Active {
  id: string; code: string; status: OrderStatus; deliveryType: string; parcelCount: number; collectCash: number; payout: number; etaMinutes: number;
  pharmacy: { name: string; address: string; mobile: string; location: GeoPoint };
  customer: { name: string; mobile: string; address: string; landmark: string; location?: GeoPoint };
}

const maps = (p?: GeoPoint) => (p ? `https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}` : undefined);
const refreshAll = (qc: ReturnType<typeof useQueryClient>) => ["rider-available", "rider-active", "rider-me", "rider-history", "rider-earnings"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
const linkBtn = "tap inline-flex items-center justify-center gap-2 rounded-control border-2 border-line-strong px-4 font-bold hover:bg-surface-2";
const primaryLink = "tap inline-flex items-center justify-center gap-2 rounded-control bg-brand-600 px-4 font-bold text-white hover:bg-brand-700";

/** One large switch. The state is written in words, not only shown by colour. */
function OnlineControl() {
  const me = useRiderMe();
  const toggle = useToggleOnline();
  const online = me.data?.available ?? false;
  return (
    <button role="switch" aria-checked={online} disabled={!me.data || toggle.isPending} onClick={() => toggle.mutate(!online)}
      className={clsx("flex w-full items-center gap-4 rounded-card border-2 p-5 text-left shadow-soft disabled:opacity-60", online ? "border-ok bg-ok-50" : "border-line-strong bg-surface")}>
      <span className={clsx("grid size-14 shrink-0 place-items-center rounded-full", online ? "bg-ok text-white" : "bg-surface-2 text-muted")}><Power className="size-7" aria-hidden /></span>
      <span className="min-w-0 flex-1">
        <span className="t-section block">{online ? "You are online" : "You are offline"}</span>
        <span className="t-support block">{online ? "New deliveries will show up below. Tap to go offline." : "Tap to go online and see deliveries near you."}</span>
        {toggle.isError && <span role="alert" className="block text-sm font-semibold text-emergency">{(toggle.error as Error).message}</span>}
      </span>
      <span aria-hidden className={clsx("h-8 w-14 shrink-0 rounded-full p-1", online ? "bg-ok" : "bg-line-strong")}><span className={clsx("block size-6 rounded-full bg-white transition-transform", online && "translate-x-6")} /></span>
    </button>
  );
}

/** Which of the 5 steps is the rider on? Customer details stay hidden until the parcel is picked up. */
function CurrentDelivery({ o }: { o: Active }) {
  const qc = useQueryClient();
  const [otp, setOtp] = useState("");
  const [atPharmacy, setAtPharmacy] = useState(false);
  const act = useMutation({
    mutationFn: (b: { action: string; otp?: string }) => post(`/api/delivery/orders/${o.id}`, b),
    onSuccess: () => { setOtp(""); refreshAll(qc); },
  });
  const step = o.status === "RIDER_ASSIGNED" ? (atPharmacy ? 1 : 0) : o.status === "PICKED_UP" ? 2 : 3;
  const otpField = (label: string) => <Input label={label} inputMode="numeric" maxLength={4} autoComplete="one-time-code" value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))} />;

  return (
    <Card as="article" className="space-y-4">
      <div className="flex items-start justify-between gap-2">
        <div><h3 className="t-section">{o.code}</h3><p className="t-support">{o.parcelCount} parcel{o.parcelCount === 1 ? "" : "s"} · you earn {inr(o.payout)}</p></div>
        {o.deliveryType === "PRIORITY" && <StatusBadge tone="danger">Priority</StatusBadge>}
      </div>
      <DeliveryStepper current={step} />

      {step < 2 ? (
        <section aria-label="Pharmacy pickup" className="space-y-3 rounded-card bg-surface-2 p-4">
          <p className="t-card flex items-center gap-2"><Store className="size-5 text-brand-600" aria-hidden /> {o.pharmacy.name}</p>
          <p className="t-support">{o.pharmacy.address}</p>
          <div className="grid grid-cols-2 gap-2">
            <a href={`tel:${o.pharmacy.mobile}`} className={linkBtn}><Phone className="size-5" aria-hidden /> Call</a>
            <a href={maps(o.pharmacy.location)} target="_blank" rel="noreferrer" className={primaryLink}><Navigation className="size-5" aria-hidden /> Navigate</a>
          </div>
          {step === 0 ? <Button size="lg" className="w-full" onClick={() => setAtPharmacy(true)}>I am at the pharmacy</Button> : (
            <div className="space-y-2">
              {otpField("Pickup code from the pharmacy")}
              <Button size="lg" className="w-full" disabled={otp.length !== 4} loading={act.isPending} onClick={() => act.mutate({ action: "pickup", otp })}>Confirm pickup</Button>
              <Button variant="ghost" className="w-full" onClick={() => act.mutate({ action: "drop" })}>I cannot do this delivery</Button>
            </div>
          )}
        </section>
      ) : (
        <section aria-label="Customer delivery" className="space-y-3 rounded-card bg-surface-2 p-4">
          <p className="t-card flex items-center gap-2"><MapPin className="size-5 text-brand-600" aria-hidden /> {o.customer.name}</p>
          <p className="t-body">{o.customer.address}</p>
          <p className="t-body font-bold">Landmark: {o.customer.landmark}</p>
          <div className="grid grid-cols-2 gap-2">
            <a href={`tel:${o.customer.mobile}`} className={linkBtn}><Phone className="size-5" aria-hidden /> Call</a>
            {maps(o.customer.location) ? <a href={maps(o.customer.location)} target="_blank" rel="noreferrer" className={primaryLink}><Navigation className="size-5" aria-hidden /> Navigate</a> : <span className="t-caption grid place-items-center">No map pin. Use the landmark.</span>}
          </div>
          {o.collectCash > 0 && <Notice tone="amber" title={`Collect cash ${inr(o.collectCash)}`}>Cash on delivery. Collect the exact amount.</Notice>}
          {step === 2 ? <Button size="lg" className="w-full" loading={act.isPending} onClick={() => act.mutate({ action: "start" })}><Truck className="size-5" aria-hidden /> I am on my way</Button> : (
            <div className="space-y-2">
              {otpField("Delivery code from the customer")}
              <Button size="lg" className="w-full" disabled={otp.length !== 4} loading={act.isPending} onClick={() => act.mutate({ action: "deliver", otp })}><CheckCircle2 className="size-5" aria-hidden /> Complete delivery</Button>
            </div>
          )}
        </section>
      )}
      {act.isError && <ErrorState message={(act.error as Error).message} />}
      <p className="t-caption">Medicine details are hidden for customer privacy. Never open the parcel.</p>
    </Card>
  );
}

function NewDelivery({ j }: { j: Available }) {
  const qc = useQueryClient();
  const accept = useMutation({ mutationFn: () => post(`/api/delivery/orders/${j.id}`, { action: "accept" }), onSettled: () => refreshAll(qc) });
  return (
    <Card as="article" className="space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div><h3 className="t-card">{j.code}</h3><p className="t-caption">Ready {fmtDateTime(j.readyAt)} · {j.parcelCount} parcel{j.parcelCount === 1 ? "" : "s"}</p></div>
        <p className="t-number text-ok">{inr(j.payout)}</p>
      </div>
      <p className="t-support flex items-start gap-2"><Store className="mt-0.5 size-4 shrink-0 text-brand-600" aria-hidden /><span><b className="text-ink">{j.pharmacy.name}</b>{j.toPharmacyKm !== undefined ? ` · ${j.toPharmacyKm} km from you` : ""}<br />{j.pharmacy.address}</span></p>
      <p className="t-support flex items-start gap-2"><MapPin className="mt-0.5 size-4 shrink-0 text-brand-600" aria-hidden />Drop: {j.dropArea}{j.dropKm !== undefined ? ` · ${j.dropKm} km` : ""}</p>
      <div className="flex flex-wrap gap-2 empty:hidden">{j.deliveryType === "PRIORITY" && <StatusBadge tone="danger">Priority</StatusBadge>}{j.collectCash > 0 && <StatusBadge tone="warning">Collect {inr(j.collectCash)} cash</StatusBadge>}</div>
      {accept.isError && <ErrorState message={(accept.error as Error).message} />}
      <Button size="lg" className="w-full" loading={accept.isPending} onClick={() => accept.mutate()}>Accept delivery</Button>
    </Card>
  );
}

export default function DeliveryHome() {
  const me = useRiderMe();
  const active = useQuery({ queryKey: ["rider-active"], queryFn: () => api<Active[]>("/api/delivery/active"), refetchInterval: 10_000 });
  const available = useQuery({ queryKey: ["rider-available"], queryFn: () => api<Available[]>("/api/delivery/available"), refetchInterval: 10_000, enabled: !!me.data?.available });
  const nActive = active.data?.length ?? 0;
  const nNew = available.data?.length ?? 0;
  return (
    <>
      <OnlineControl />
      <div className="grid grid-cols-2 gap-3">
        <DashboardMetricCard icon={<PackageCheck />} label="New delivery" value={me.data?.available ? nNew : "–"} tone={nNew ? "attention" : "neutral"} hint={me.data?.available ? (nNew ? "Ready to accept" : "None right now") : "Go online to see"} />
        <DashboardMetricCard icon={<Truck />} label="Current delivery" value={nActive} tone={nActive ? "attention" : "neutral"} hint={nActive ? "In progress" : "Nothing active"} />
        <DashboardMetricCard icon={<IndianRupee />} label="Earnings today" value={me.data ? inr(me.data.earningsToday) : "–"} href="/delivery/earnings" tone="success" />
        <DashboardMetricCard icon={<CheckCircle2 />} label="Completed today" value={me.data?.deliveriesToday ?? "–"} href="/delivery/history" />
      </div>

      <section aria-labelledby="cur"><SectionHeader id="cur" title="Current delivery" />
        <QueryBoundary query={active} skeleton={<SkeletonList rows={1} lines={5} />} isEmpty={(d) => d.length === 0} empty={<EmptyState title="No active delivery" body="Accept a new delivery below." />}>
          {(list) => <div className="space-y-3">{list.map((o) => <CurrentDelivery key={o.id} o={o} />)}</div>}
        </QueryBoundary>
      </section>

      <section aria-labelledby="new"><SectionHeader id="new" title="New deliveries" />
        {!me.data?.available ? (
          <EmptyState title="You are offline" body="Turn on Online at the top to see deliveries near you." />
        ) : (
          <QueryBoundary query={available} skeleton={<SkeletonList rows={2} lines={3} />} isEmpty={(d) => d.length === 0} empty={<EmptyState title="No deliveries right now" body="New orders appear here when pharmacies mark them ready. This list refreshes by itself." />}>
            {(list) => <div className="space-y-3">{list.map((j) => <NewDelivery key={j.id} j={j} />)}</div>}
          </QueryBoundary>
        )}
      </section>
    </>
  );
}
