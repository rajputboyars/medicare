"use client";
import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Search, SlidersHorizontal, X } from "lucide-react";
import { api } from "@/lib/api";
import { useLocation } from "@/lib/store";
import { MedicineCard, pickOffer, type Strategy } from "@/components/medicine/medicine-card";
import { Button, EmptyState, Input, LinkButton, PageTitle, QueryBoundary, Select, SkeletonList } from "@/components/ui";
import type { MedicineResult } from "@/server/services/finder";

function useDebounced<T>(v: T, ms = 300) {
  const [d, setD] = useState(v);
  useEffect(() => { const id = setTimeout(() => setD(v), ms); return () => clearTimeout(id); }, [v, ms]);
  return d;
}

/** Available medicines first; within them, best offer by the chosen strategy (time, price or distance). */
function sortBy(list: MedicineResult[], strategy: Strategy, preferredId?: string) {
  const key = (r: MedicineResult) => {
    const o = pickOffer(r.offers, strategy, preferredId);
    if (!o) return Number.POSITIVE_INFINITY;
    return strategy === "cheapest" ? o.sellingPrice : strategy === "nearest" ? o.distanceKm : o.etaMinutes;
  };
  return [...list].sort((a, b) => Number(b.available) - Number(a.available) || key(a) - key(b));
}

function Search_() {
  const router = useRouter();
  const sp = useSearchParams();
  const pincode = useLocation((s) => s.pincode);
  const [q, setQ] = useState(sp.get("q") ?? "");
  const [category, setCategory] = useState(sp.get("category") ?? "");
  const [rx, setRx] = useState(sp.get("rx") ?? "");
  const [brand, setBrand] = useState("");
  const [maxPrice, setMaxPrice] = useState("");
  const [nearby, setNearby] = useState(false);
  const [strategy, setStrategy] = useState<Strategy>("fastest");
  const [preferred, setPreferred] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const dq = useDebounced(q);

  useEffect(() => {
    const p = new URLSearchParams();
    if (dq) p.set("q", dq);
    if (category) p.set("category", category);
    if (rx) p.set("rx", rx);
    router.replace(`/medicines${p.size ? `?${p}` : ""}`, { scroll: false });
  }, [dq, category, rx, router]);

  const meta = useQuery({ queryKey: ["meta"], queryFn: () => api<{ categories: string[]; brands: string[] }>("/api/medicines/meta"), staleTime: 10 * 60_000 });
  const pharmacies = useQuery({ queryKey: ["pharmacies", pincode], queryFn: () => api<{ id: string; name: string }[]>(`/api/pharmacies/nearby?pincode=${pincode}`) });

  const params = new URLSearchParams({ pincode });
  if (dq) params.set("q", dq);
  if (category) params.set("category", category);
  if (rx) params.set("rx", rx);
  if (brand) params.set("brand", brand);
  if (maxPrice) params.set("maxPrice", maxPrice);
  if (nearby) params.set("availableNearby", "1");
  const results = useQuery({ queryKey: ["search", params.toString()], queryFn: () => api<MedicineResult[]>(`/api/medicines/search?${params}`), placeholderData: (prev) => prev });

  const activeFilters = [category, rx, brand, maxPrice, nearby ? "1" : ""].filter(Boolean).length;
  const reset = () => { setCategory(""); setRx(""); setBrand(""); setMaxPrice(""); setNearby(false); };

  return (
    <>
      <PageTitle title="Find Medicine" subtitle="Search by medicine, generic name, brand or health need." />
      <form role="search" onSubmit={(e) => e.preventDefault()} className="sticky top-[4.2rem] z-20 -mx-1 mb-4 space-y-3 bg-canvas/95 p-1 backdrop-blur">
        <div className="relative">
          <Search className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-muted" aria-hidden />
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. Paracetamol, Metformin, thyroid" aria-label="Search medicines"
            className="min-h-14 w-full rounded-2xl border-2 border-line bg-white pl-12 pr-12 text-lg focus:border-brand-600" autoFocus />
          {q && <button type="button" onClick={() => setQ("")} aria-label="Clear search" className="absolute right-2 top-1/2 grid size-10 -translate-y-1/2 place-items-center rounded-xl"><X className="size-5" aria-hidden /></button>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant={showFilters ? "soft" : "secondary"} className="min-h-11 py-2" onClick={() => setShowFilters((s) => !s)} aria-expanded={showFilters}>
            <SlidersHorizontal className="size-4" aria-hidden /> Filters{activeFilters ? ` (${activeFilters})` : ""}
          </Button>
          <div role="radiogroup" aria-label="Choose by" className="flex flex-wrap gap-2">
            {([["fastest", "Fastest"], ["cheapest", "Cheapest"], ["nearest", "Nearest"], ["preferred", "My pharmacy"]] as const).map(([v, label]) => (
              <button key={v} type="button" role="radio" aria-checked={strategy === v} onClick={() => setStrategy(v)}
                className={`min-h-11 rounded-2xl border-2 px-4 text-sm font-semibold ${strategy === v ? "border-brand-600 bg-brand-50 text-brand-800" : "border-line bg-white"}`}>{label}</button>
            ))}
          </div>
        </div>
        {strategy === "preferred" && (
          <Select label="Preferred pharmacy" value={preferred} onChange={(e) => setPreferred(e.target.value)}>
            <option value="">Choose a pharmacy</option>
            {pharmacies.data?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
        )}
        {showFilters && (
          <div className="grid gap-3 rounded-2xl border border-line bg-white p-4 sm:grid-cols-2">
            <Select label="Category" value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="">All categories</option>
              {meta.data?.categories.map((c) => <option key={c}>{c}</option>)}
            </Select>
            <Select label="Brand" value={brand} onChange={(e) => setBrand(e.target.value)}>
              <option value="">All brands</option>
              {meta.data?.brands.map((c) => <option key={c}>{c}</option>)}
            </Select>
            <Select label="Prescription" value={rx} onChange={(e) => setRx(e.target.value)}>
              <option value="">Any</option>
              <option value="no">Without prescription</option>
              <option value="yes">Prescription needed</option>
            </Select>
            <Input label="Maximum price (₹)" inputMode="numeric" value={maxPrice} onChange={(e) => setMaxPrice(e.target.value.replace(/\D/g, ""))} />
            <label className="flex min-h-12 items-center gap-3 font-semibold sm:col-span-2">
              <input type="checkbox" className="size-6 accent-brand-600" checked={nearby} onChange={(e) => setNearby(e.target.checked)} /> Available nearby only
            </label>
            {activeFilters > 0 && <Button variant="ghost" onClick={reset}>Clear all filters</Button>}
          </div>
        )}
      </form>

      <div aria-live="polite" className="space-y-3">
        <QueryBoundary query={results} skeleton={<SkeletonList rows={4} height="h-40" />} isEmpty={(d) => d.length === 0}
          empty={<EmptyState title="No medicine found" body="Check the spelling, or let us ask nearby pharmacies to find it for you." action={<LinkButton href={`/find-medicine?q=${encodeURIComponent(q)}`}>Find this medicine for me</LinkButton>} />}>
          {(list) => (
            <>
              <p className="text-sm text-muted">{list.length} {list.length === 1 ? "result" : "results"} for pincode {pincode}</p>
              {sortBy(list, strategy, preferred || undefined).map((r) => <MedicineCard key={r.medicine.id} r={r} strategy={strategy} preferredId={preferred || undefined} />)}
            </>
          )}
        </QueryBoundary>
      </div>
    </>
  );
}

export default function MedicinesPage() {
  return <Suspense fallback={<SkeletonList rows={4} height="h-40" />}><Search_ /></Suspense>;
}
