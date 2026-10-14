"use client";
import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Check, SlidersHorizontal } from "lucide-react";
import clsx from "clsx";
import { api } from "@/lib/api";
import { useLocation } from "@/lib/store";
import { MedicineCard, pickOffer } from "@/components/medicine/medicine-card";
import { SortChips, type Strategy } from "@/components/medicine/sort-chips";
import { Button, EmptyState, Input, LinkButton, Modal, PageTitle, QueryBoundary, SearchBar, Select, SkeletonList } from "@/components/ui";
import type { MedicineResult } from "@/server/features/medicines/finder.service";

function useDebounced<T>(v: T, ms = 300) {
  const [d, setD] = useState(v);
  useEffect(() => { const id = setTimeout(() => setD(v), ms); return () => clearTimeout(id); }, [v, ms]);
  return d;
}

/** Available medicines first; within them, the best offer by the chosen sort (time, price or distance). */
function sortBy(list: MedicineResult[], strategy: Strategy, preferredId?: string) {
  const key = (r: MedicineResult) => {
    const o = pickOffer(r.offers, strategy, preferredId);
    if (!o) return Number.POSITIVE_INFINITY;
    return strategy === "cheapest" ? o.sellingPrice : strategy === "nearest" ? o.distanceKm : o.etaMinutes;
  };
  return [...list].sort((a, b) => Number(b.available) - Number(a.available) || key(a) - key(b));
}

function MedicineSearch() {
  const router = useRouter();
  const sp = useSearchParams();
  const pincode = useLocation((s) => s.pincode);
  const [q, setQ] = useState(sp.get("q") ?? "");
  const [category, setCategory] = useState(sp.get("category") ?? "");
  const [rx, setRx] = useState(sp.get("rx") ?? "");
  const [brand, setBrand] = useState("");
  const [maxPrice, setMaxPrice] = useState("");
  const [available, setAvailable] = useState(false);
  const [strategy, setStrategy] = useState<Strategy>("fastest");
  const [preferred, setPreferred] = useState("");
  const [filters, setFilters] = useState(false);
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
  if (available) params.set("availableNearby", "1");
  const results = useQuery({ queryKey: ["search", params.toString()], queryFn: () => api<MedicineResult[]>(`/api/medicines/search?${params}`), placeholderData: (prev) => prev });

  const activeFilters = [category, rx, brand, maxPrice, preferred].filter(Boolean).length;
  const effective: Strategy = preferred ? "preferred" : strategy;
  const reset = () => { setCategory(""); setRx(""); setBrand(""); setMaxPrice(""); setPreferred(""); };

  return (
    <>
      <PageTitle title="Medicines" subtitle="Search by medicine, generic name, brand or health need." />

      {/* Sticky: the search box and the choices stay in reach while scrolling results */}
      <div className="sticky top-[4.1rem] z-20 -mx-3 mb-4 space-y-3 border-b border-line bg-canvas/95 px-3 pb-3 pt-1 backdrop-blur sm:-mx-6 sm:px-6">
        <SearchBar value={q} onChange={setQ} placeholder="e.g. Paracetamol, Metformin, thyroid" label="Search medicines" />
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" role="switch" aria-checked={available} onClick={() => setAvailable((a) => !a)}
            className={clsx("tap inline-flex items-center gap-1.5 rounded-pill border-2 px-4 text-sm", available ? "border-ok bg-ok-50 font-bold text-ok" : "border-line-strong bg-surface font-semibold")}>
            {available && <Check className="size-4" aria-hidden />} Available
          </button>
          <SortChips value={strategy} onChange={(s) => { setStrategy(s); setPreferred(""); }} />
          <Button variant={activeFilters ? "soft" : "secondary"} size="sm" className="min-h-11" onClick={() => setFilters(true)}>
            <SlidersHorizontal className="size-4" aria-hidden /> More filters{activeFilters ? ` (${activeFilters})` : ""}
          </Button>
        </div>
      </div>

      <div aria-live="polite" className="space-y-3">
        <QueryBoundary query={results} skeleton={<SkeletonList rows={4} lines={4} />} isEmpty={(d) => d.length === 0}
          empty={<EmptyState title="No medicine found" body="Check the spelling, or let us ask nearby pharmacies to find it for you." action={<LinkButton href={`/find-medicine${q ? `?q=${encodeURIComponent(q)}` : ""}`}>Find My Medicine</LinkButton>} />}>
          {(list) => (
            <>
              <p className="t-caption">{list.length} {list.length === 1 ? "result" : "results"} for pincode {pincode}. Showing {effective === "cheapest" ? "lowest price" : effective === "nearest" ? "nearest pharmacy" : effective === "preferred" ? "your pharmacy" : "fastest delivery"} first.</p>
              <div className="grid gap-3 md:grid-cols-2">
                {sortBy(list, effective, preferred || undefined).map((r) => <MedicineCard key={r.medicine.id} r={r} strategy={effective} preferredId={preferred || undefined} />)}
              </div>
            </>
          )}
        </QueryBoundary>
      </div>

      <Modal open={filters} onClose={() => setFilters(false)} title="More filters"
        footer={<><Button variant="ghost" onClick={reset} disabled={!activeFilters}>Clear all</Button><Button onClick={() => setFilters(false)}>Show results</Button></>}>
        <div className="space-y-4">
          <Select label="What is it for?" value={category} onChange={(e) => setCategory(e.target.value)}><option value="">All</option>{meta.data?.categories.map((c) => <option key={c}>{c}</option>)}</Select>
          <Select label="Prescription" value={rx} onChange={(e) => setRx(e.target.value)}><option value="">Any</option><option value="no">No prescription needed</option><option value="yes">Prescription needed</option></Select>
          <Select label="Brand" value={brand} onChange={(e) => setBrand(e.target.value)}><option value="">All brands</option>{meta.data?.brands.map((c) => <option key={c}>{c}</option>)}</Select>
          <Input label="Highest price (₹)" inputMode="numeric" value={maxPrice} onChange={(e) => setMaxPrice(e.target.value.replace(/\D/g, ""))} />
          <Select label="Only from my pharmacy" value={preferred} onChange={(e) => setPreferred(e.target.value)}><option value="">Any nearby pharmacy</option>{pharmacies.data?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select>
        </div>
      </Modal>
    </>
  );
}

export default function MedicinesPage() {
  return <Suspense fallback={<SkeletonList rows={4} lines={4} />}><MedicineSearch /></Suspense>;
}
