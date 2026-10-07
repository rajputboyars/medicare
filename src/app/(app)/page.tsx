"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Clock, MapPin, Percent, Phone, Pill, Repeat, Search, ShieldCheck, Star, Upload, SearchCheck, Truck } from "lucide-react";
import { api } from "@/lib/api";
import { useLocation } from "@/lib/store";
import { SUPPORT_PHONE, useMe, useT } from "@/lib/hooks";
import { inr } from "@/lib/pricing";
import { STATUS_LABEL, isFinal, statusTone } from "@/lib/order-machine";
import { MedicineCard } from "@/components/medicine/medicine-card";
import { Badge, Card, EmptyState, LinkButton, Notice, QueryBoundary, Skeleton, SkeletonList, Verified } from "@/components/ui";
import type { MedicineResult } from "@/server/services/finder";
import type { Offer, Order, SavedMedicine } from "@/lib/types";

const Section = ({ title, href, children, id }: { title: string; href?: string; children: React.ReactNode; id?: string }) => (
  <section aria-labelledby={id} className="mt-8">
    <div className="mb-3 flex items-end justify-between gap-3">
      <h2 id={id} className="text-xl font-extrabold">{title}</h2>
      {href && <Link href={href} className="flex min-h-10 items-center gap-1 text-sm font-bold text-brand-700">See all <ArrowRight className="size-4" aria-hidden /></Link>}
    </div>
    {children}
  </section>
);

function QuickActions() {
  const t = useT();
  const items = [
    { href: "/medicines", label: t("orderMedicine"), hint: "Search nearby pharmacies", icon: Pill, tone: "bg-brand-600 text-white border-brand-600" },
    { href: "/upload-prescription", label: t("uploadPrescription"), hint: "Pharmacist checks it", icon: Upload, tone: "bg-white" },
    { href: "/find-medicine", label: t("findMedicine"), hint: "Ask nearby shops", icon: SearchCheck, tone: "bg-white" },
    { href: "/repeat", label: t("repeatOrder"), hint: "One tap reorder", icon: Repeat, tone: "bg-white" },
  ];
  return (
    <ul className="mt-5 grid grid-cols-2 gap-3">
      {items.map((i) => (
        <li key={i.href}>
          <Link href={i.href} className={`flex min-h-32 flex-col justify-between rounded-[1.25rem] border p-4 shadow-soft ${i.tone}`}>
            <i.icon className="size-9" aria-hidden />
            <span><span className="block text-lg font-bold leading-tight">{i.label}</span><span className={`text-sm ${i.tone.includes("text-white") ? "text-brand-100" : "text-muted"}`}>{i.hint}</span></span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function CantFind() {
  const t = useT();
  return (
    <Card className="mt-5 border-2 border-brand-200 bg-brand-50">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-extrabold">{t("cantFindTitle")}</h2>
          <p className="mt-1 text-muted">{t("cantFindBody")}</p>
        </div>
        <LinkButton href="/find-medicine" className="w-full sm:w-auto">{t("findMyMedicine")}</LinkButton>
      </div>
    </Card>
  );
}

function QuickOrderCard() {
  const t = useT();
  return (
    <Card className="mt-4 flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-3"><Phone className="size-8 shrink-0 text-brand-600" aria-hidden />
        <div><p className="font-bold">Not comfortable with apps?</p><p className="text-sm text-muted">Send a photo of your prescription. We call you back and complete the order.</p></div></div>
      <div className="flex w-full flex-wrap gap-2 sm:w-auto">
        <LinkButton href="/quick-order" variant="secondary" className="flex-1">{t("callMe")}</LinkButton>
        <a href={`tel:${SUPPORT_PHONE}`} className="inline-flex min-h-12 flex-1 items-center justify-center gap-2 rounded-2xl bg-brand-50 px-5 font-semibold text-brand-800"><Phone className="size-5" aria-hidden /> {t("callSupport")}</a>
      </div>
    </Card>
  );
}

function ActiveOrders() {
  const me = useMe();
  const q = useQuery({ queryKey: ["orders"], queryFn: () => api<Order[]>("/api/orders"), enabled: me.data?.role === "CUSTOMER", refetchInterval: 20_000 });
  const active = q.data?.filter((o) => !isFinal(o.status)).slice(0, 2) ?? [];
  const last = q.data?.find((o) => o.status === "DELIVERED");
  if (!active.length && !last) return null;
  return (
    <>
      {active.length > 0 && (
        <Section title="Your order is on its way" id="active">
          <div className="space-y-3">{active.map((o) => (
            <Card key={o.id}><Link href={`/orders/${o.id}`} className="flex flex-wrap items-center justify-between gap-2">
              <div><p className="font-bold">{o.code} · {inr(o.total)}</p><p className="text-sm text-muted">{o.items.map((i) => i.name).join(", ")}</p></div>
              <div className="flex items-center gap-2"><Badge tone={statusTone(o.status)}><Truck className="size-3.5" aria-hidden /> {STATUS_LABEL[o.status]}</Badge><ArrowRight className="size-5 text-brand-700" aria-hidden /></div>
            </Link></Card>
          ))}</div>
        </Section>
      )}
      {last && (
        <Section title="Repeat previous order" id="repeat">
          <Card className="flex flex-wrap items-center justify-between gap-3">
            <div><p className="font-bold">{last.code} · {inr(last.total)}</p><p className="text-sm text-muted">{last.items.map((i) => `${i.name} ×${i.quantity}`).join(", ")}</p></div>
            <LinkButton href="/repeat" variant="secondary"><Repeat className="size-5" aria-hidden /> Repeat Order</LinkButton>
          </Card>
        </Section>
      )}
    </>
  );
}

function SavedDue() {
  const me = useMe();
  const q = useQuery({ queryKey: ["saved"], queryFn: () => api<(SavedMedicine & { daysLeft: number; forName?: string })[]>("/api/saved"), enabled: me.data?.role === "CUSTOMER" });
  const due = q.data?.filter((r) => r.daysLeft <= 7) ?? [];
  if (!due.length) return null;
  return (
    <Section title="Refill coming up" href="/repeat" id="refill">
      {due.slice(0, 2).map((r) => (
        <Card key={r.id} className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div><p className="font-bold">{r.label}{r.forName ? ` · ${r.forName}` : ""}</p><p className="text-sm font-semibold text-warn">{r.daysLeft <= 0 ? "Refill due now" : `Refill due in ${r.daysLeft} days`}</p></div>
          <LinkButton href="/repeat">Reorder</LinkButton>
        </Card>
      ))}
    </Section>
  );
}

function MedicinesNearYou({ pincode }: { pincode: string }) {
  const q = useQuery({ queryKey: ["home-meds", pincode], queryFn: () => api<MedicineResult[]>(`/api/medicines/search?pincode=${pincode}&availableNearby=1&rx=no&limit=4`) });
  return (
    <Section title="Medicines near you" href="/medicines" id="near">
      <QueryBoundary query={q} skeleton={<SkeletonList rows={2} height="h-40" />} isEmpty={(d) => d.length === 0} empty={<EmptyState title="No stock information yet" body="Search for a medicine to see what is available near you." action={<LinkButton href="/medicines">Search medicines</LinkButton>} />}>
        {(list) => <div className="grid gap-3 md:grid-cols-2">{list.slice(0, 4).map((r) => <MedicineCard key={r.medicine.id} r={r} strategy="fastest" />)}</div>}
      </QueryBoundary>
    </Section>
  );
}

function Pharmacies({ pincode }: { pincode: string }) {
  const q = useQuery({ queryKey: ["pharmacies", pincode], queryFn: () => api<{ id: string; name: string; address: string; distanceKm: number; rating: number; ratingCount: number; open: boolean; closeTime: string; priorityDelivery: boolean }[]>(`/api/pharmacies/nearby?pincode=${pincode}`) });
  return (
    <Section title="Nearby verified pharmacies" id="pharm">
      <QueryBoundary query={q} skeleton={<SkeletonList rows={2} height="h-28" />} isEmpty={(d) => d.length === 0} empty={<EmptyState title="No pharmacy covers this pincode yet" body="We are adding partners every week." />}>
        {(list) => (
          <ul className="grid gap-3 md:grid-cols-2">
            {list.map((p) => (
              <Card as="li" key={p.id} className="space-y-1.5">
                <div className="flex items-start justify-between gap-2"><h3 className="font-bold">{p.name}</h3><Verified label="Verified" /></div>
                <p className="text-sm text-muted">{p.address}</p>
                <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                  <span className="flex items-center gap-1"><MapPin className="size-4 text-brand-600" aria-hidden /> {p.distanceKm} km</span>
                  {p.rating > 0 && <span className="flex items-center gap-1"><Star className="size-4 text-amber-500" aria-hidden /> {p.rating} ({p.ratingCount})</span>}
                  <span className={`flex items-center gap-1 ${p.open ? "text-ok" : "text-warn"}`}><Clock className="size-4" aria-hidden /> {p.open ? `Open till ${p.closeTime}` : "Closed now"}</span>
                </p>
              </Card>
            ))}
          </ul>
        )}
      </QueryBoundary>
    </Section>
  );
}

function Offers() {
  const q = useQuery({ queryKey: ["offers"], queryFn: () => api<Offer[]>("/api/offers") });
  return (
    <Section title="Offers" id="offers">
      <QueryBoundary query={q} skeleton={<Skeleton className="h-20 w-full" />} isEmpty={(d) => d.length === 0} empty={<p className="text-muted">No offers right now.</p>}>
        {(list) => <ul className="grid gap-3 md:grid-cols-2">{list.map((o) => (
          <Card as="li" key={o.id} className="flex items-center gap-3 bg-warn-50"><Percent className="size-7 shrink-0 text-warn" aria-hidden /><div><p className="font-bold">{o.title}</p><p className="text-sm text-muted">{o.description} Code <b>{o.code}</b></p></div></Card>
        ))}</ul>}
      </QueryBoundary>
    </Section>
  );
}

export default function HomePage() {
  const t = useT();
  const router = useRouter();
  const pincode = useLocation((s) => s.pincode);
  const [q, setQ] = useState("");
  const coverage = useQuery({ queryKey: ["coverage", pincode], queryFn: () => api<{ available: boolean; message?: string }>(`/api/coverage?pincode=${pincode}`) });
  const live = coverage.data?.available !== false;

  return (
    <>
      <section className="rounded-[1.75rem] bg-brand-600 p-5 text-white shadow-soft sm:p-8">
        <p className="flex items-center gap-2 text-sm font-semibold text-brand-100"><ShieldCheck className="size-4" aria-hidden /> Verified local pharmacies</p>
        <h1 className="mt-2 text-3xl font-extrabold leading-tight sm:text-4xl">{t("tagline")}</h1>
        <form role="search" onSubmit={(e) => { e.preventDefault(); router.push(`/medicines${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ""}`); }} className="mt-5 flex flex-col gap-2 sm:flex-row">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-muted" aria-hidden />
            <input value={q} onChange={(e) => setQ(e.target.value)} type="search" aria-label={t("searchPlaceholder")} placeholder={t("searchPlaceholder")}
              className="min-h-14 w-full rounded-2xl bg-white pl-12 pr-3 text-base text-ink placeholder:text-stone-500 sm:text-lg" />
          </div>
          <button type="submit" className="min-h-14 rounded-2xl bg-white px-6 text-lg font-bold text-brand-800 hover:bg-brand-50">Search</button>
        </form>
      </section>

      {!live && <div className="mt-5"><Notice tone="amber" title={t("comingToYourArea")}>We don&apos;t deliver to {pincode} yet. Use the area selector at the top to leave your mobile number and we&apos;ll tell you when we launch.</Notice></div>}

      <QuickActions />
      <CantFind />
      <QuickOrderCard />

      {live && (
        <>
          <ActiveOrders />
          <SavedDue />
          <MedicinesNearYou pincode={pincode} />
          <Pharmacies pincode={pincode} />
        </>
      )}
      <Offers />

      <Section title="How it works" id="how">
        <ol className="grid gap-3 sm:grid-cols-3">
          {[["1", "Find or upload", "Search a medicine or upload your prescription."], ["2", "Pharmacy confirms", "A verified local pharmacist checks and prepares it."], ["3", "Delivered to you", "A delivery partner brings it. Share the code to receive."]].map(([n, h, b]) => (
            <Card as="li" key={n}><span className="mb-2 grid size-9 place-items-center rounded-full bg-brand-600 font-bold text-white">{n}</span><p className="font-bold">{h}</p><p className="text-sm text-muted">{b}</p></Card>
          ))}
        </ol>
        <p className="mt-4 text-sm text-muted">Delivery times are estimates. They depend on stock, prescription check and rider availability.</p>
      </Section>
    </>
  );
}
