"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Clock, MapPin, Phone, Pill, Repeat as RepeatIcon, SearchCheck, Star, Truck, Upload } from "lucide-react";
import { api } from "@/lib/api";
import { useLocation } from "@/lib/store";
import { useMe, useT } from "@/lib/hooks";
import { inr } from "@/lib/pricing";
import { isFinal } from "@/lib/order-machine";
import { shortStatus } from "@/lib/order-copy";
import { LocationSelector } from "@/components/layout/location-selector";
import { QuickActionCard } from "@/components/customer/quick-action-card";
import { MedicineCard } from "@/components/medicine/medicine-card";
import { OrderStatusBadge } from "@/components/order/order-status-badge";
import { Card, EmptyState, LazyMount, LinkButton, Notice, QueryBoundary, SearchBar, SectionHeader, SkeletonList, StatusBadge, Verified } from "@/components/ui";
import type { MedicineResult } from "@/server/services/finder";
import type { Order, SavedMedicine } from "@/lib/types";

/** Home, in this order: location → search → quick actions → Find My Medicine → repeat medicines → nearby pharmacies → health essentials. */
export default function HomePage() {
  const t = useT();
  const router = useRouter();
  const pincode = useLocation((s) => s.pincode);
  const [q, setQ] = useState("");
  const coverage = useQuery({ queryKey: ["coverage", pincode], queryFn: () => api<{ available: boolean; message?: string }>(`/api/coverage?pincode=${pincode}`) });
  const live = coverage.data?.available !== false;

  return (
    <div className="space-y-6">
      <LocationSelector variant="bar" />

      {!live && <Notice tone="amber" title={t("comingToYourArea")}>We do not deliver to {pincode} yet. Tap the area above to leave your mobile number and we will tell you when we launch.</Notice>}

      <SearchBar value={q} onChange={setQ} placeholder={t("searchPlaceholder")} label={t("searchPlaceholder")} submitLabel="Search"
        onSubmit={() => router.push(`/medicines${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ""}`)} />

      <section aria-label="Quick actions">
        <ul className="grid grid-cols-2 gap-3">
          <li><QuickActionCard primary href="/medicines" icon={Pill} title={t("orderMedicine")} hint="Search nearby pharmacies" /></li>
          <li><QuickActionCard href="/upload-prescription" icon={Upload} title={t("uploadPrescription")} hint="A pharmacist checks it" /></li>
          <li><QuickActionCard href="/find-medicine" icon={SearchCheck} title={t("findMedicine")} hint="Ask nearby pharmacies" /></li>
          <li><QuickActionCard href="/repeat" icon={RepeatIcon} title={t("repeatOrder")} hint="Order again in one tap" /></li>
        </ul>
      </section>

      <FindMyMedicineCta />

      <RepeatMedicines live={live} />

      {live && (
        <>
          <LazyMount><NearbyPharmacies pincode={pincode} /></LazyMount>
          <LazyMount><HealthEssentials pincode={pincode} /></LazyMount>
        </>
      )}
    </div>
  );
}

/** The most prominent block on Home: the safety net for anyone who cannot find their medicine. */
function FindMyMedicineCta() {
  const t = useT();
  return (
    <section aria-labelledby="cant-find" className="overflow-hidden rounded-card bg-brand-700 p-5 text-white shadow-raised sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-5">
        <div className="flex min-w-0 items-start gap-4">
          <span className="grid size-14 shrink-0 place-items-center rounded-full bg-white/15"><SearchCheck className="size-8" aria-hidden /></span>
          <div>
            <h2 id="cant-find" className="t-section text-[1.35rem]">{t("cantFindTitle")}</h2>
            <p className="mt-1 text-brand-100">{t("cantFindBody")}</p>
          </div>
        </div>
        <Link href="/find-medicine" className="tap inline-flex min-h-14 w-full items-center justify-center gap-2 rounded-control bg-white px-6 text-lg font-bold text-brand-800 hover:bg-brand-50 sm:w-auto">{t("findMyMedicine")} <ArrowRight className="size-5" aria-hidden /></Link>
      </div>
      <p className="mt-4 flex items-center gap-2 border-t border-white/20 pt-3 text-sm text-brand-100"><Phone className="size-4 shrink-0" aria-hidden /> Prefer a phone call? <Link href="/quick-order" className="font-bold text-white underline">{t("callMe")}</Link></p>
    </section>
  );
}

/** Repeat medicines: refills that are due, the last delivered order, and an order currently on its way. */
function RepeatMedicines({ live }: { live: boolean }) {
  const me = useMe();
  const customer = me.data?.role === "CUSTOMER";
  const orders = useQuery({ queryKey: ["orders"], queryFn: () => api<Order[]>("/api/orders"), enabled: customer, refetchInterval: 30_000 });
  const saved = useQuery({ queryKey: ["saved"], queryFn: () => api<(SavedMedicine & { daysLeft: number; forName?: string })[]>("/api/saved"), enabled: customer });

  if (me.isPending) return <SkeletonList rows={1} lines={2} />;
  if (!customer) {
    return (
      <section aria-labelledby="repeat-h"><SectionHeader id="repeat-h" title="Repeat medicines" />
        <EmptyState title="Log in to order again in one tap" body="Your past orders and monthly medicines will show here." action={<LinkButton href="/login">Log in</LinkButton>} />
      </section>
    );
  }
  const onTheWay = orders.data?.filter((o) => !isFinal(o.status)).slice(0, 1) ?? [];
  const last = orders.data?.find((o) => o.status === "DELIVERED");
  const due = saved.data?.filter((r) => r.daysLeft <= 7).slice(0, 2) ?? [];
  const nothing = !onTheWay.length && !last && !due.length;

  return (
    <section aria-labelledby="repeat-h">
      <SectionHeader id="repeat-h" title="Repeat medicines" href="/repeat" />
      <div className="space-y-3">
        {onTheWay.map((o) => (
          <Card key={o.id}><Link href={`/orders/${o.id}`} className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3"><span className="grid size-11 shrink-0 place-items-center rounded-control bg-info-50 text-info"><Truck className="size-6" aria-hidden /></span>
              <div className="min-w-0"><p className="t-card">Order {o.code}</p><p className="t-support">{shortStatus(o.status)}</p></div></div>
            <span className="flex items-center gap-2"><OrderStatusBadge status={o.status} /><ArrowRight className="size-5 text-brand-700" aria-hidden /></span>
          </Link></Card>
        ))}
        {due.map((r) => (
          <Card key={r.id} className="flex flex-wrap items-center justify-between gap-3">
            <div><p className="t-card">{r.label}{r.forName ? ` · ${r.forName}` : ""}</p>
              <StatusBadge tone="warning">{r.daysLeft <= 0 ? "Refill due now" : `Refill due in ${r.daysLeft} days`}</StatusBadge></div>
            <LinkButton href="/repeat">Order again</LinkButton>
          </Card>
        ))}
        {last && (
          <Card className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0"><p className="t-card">Last order · {inr(last.total)}</p><p className="t-support line-clamp-1">{last.items.map((i) => `${i.name} ×${i.quantity}`).join(", ")}</p></div>
            <LinkButton href="/repeat" variant="secondary"><RepeatIcon className="size-5" aria-hidden /> Repeat Order</LinkButton>
          </Card>
        )}
        {nothing && <EmptyState title="No past orders yet" body={live ? "Once you order, you can repeat it here in one tap." : "We are coming to your area soon."} action={<LinkButton href="/medicines">Order Medicine</LinkButton>} />}
      </div>
    </section>
  );
}

function NearbyPharmacies({ pincode }: { pincode: string }) {
  const q = useQuery({ queryKey: ["pharmacies", pincode], queryFn: () => api<{ id: string; name: string; address: string; distanceKm: number; rating: number; ratingCount: number; open: boolean; closeTime: string; openTime: string }[]>(`/api/pharmacies/nearby?pincode=${pincode}`) });
  return (
    <section aria-labelledby="pharm"><SectionHeader id="pharm" title="Nearby pharmacies" />
      <QueryBoundary query={q} skeleton={<SkeletonList rows={2} lines={3} />} isEmpty={(d) => d.length === 0} empty={<EmptyState title="No pharmacy covers this pincode yet" body="We are adding partners every week." />}>
        {(list) => (
          <ul className="grid gap-3 md:grid-cols-2">
            {list.map((p) => (
              <Card as="li" key={p.id} className="space-y-2">
                <div className="flex items-start justify-between gap-2"><h3 className="t-card">{p.name}</h3><Verified label="Verified" /></div>
                <p className="t-support">{p.address}</p>
                <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                  <span className="flex items-center gap-1.5"><MapPin className="size-4 text-brand-600" aria-hidden /> {p.distanceKm} km</span>
                  {p.rating > 0 && <span className="flex items-center gap-1.5"><Star className="size-4 text-amber-500" aria-hidden /> {p.rating} ({p.ratingCount})</span>}
                  <span className="flex items-center gap-1.5"><Clock className="size-4" aria-hidden />{p.open ? <b className="text-ok">Open till {p.closeTime}</b> : <b className="text-warn">Closed · opens {p.openTime}</b>}</span>
                </p>
              </Card>
            ))}
          </ul>
        )}
      </QueryBoundary>
    </section>
  );
}

function HealthEssentials({ pincode }: { pincode: string }) {
  const q = useQuery({ queryKey: ["essentials", pincode], queryFn: () => api<MedicineResult[]>(`/api/medicines/search?pincode=${pincode}&category=Health%20Essentials&rx=no`) });
  return (
    <section aria-labelledby="ess"><SectionHeader id="ess" title="Health essentials" href="/medicines?category=Health%20Essentials" />
      <QueryBoundary query={q} skeleton={<SkeletonList rows={1} lines={4} />} isEmpty={(d) => d.length === 0} empty={<p className="t-support">Nothing in stock nearby yet.</p>}>
        {(list) => <div className="grid gap-3 md:grid-cols-2">{list.slice(0, 2).map((r) => <MedicineCard key={r.medicine.id} r={r} strategy="cheapest" />)}</div>}
      </QueryBoundary>
    </section>
  );
}
