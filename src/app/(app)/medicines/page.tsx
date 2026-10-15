"use client";
import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Check, SearchCheck, SpellCheck, Type } from "lucide-react";
import clsx from "clsx";
import { ApiClientError } from "@/lib/api";
import { useLocation } from "@/lib/store";
import { trackEvent } from "@/lib/analytics-client";
import { useRecentSearches } from "@/lib/search-history";
import { SearchBox } from "@/components/medicine/search-box";
import { SearchResultCard } from "@/components/medicine/search-result-card";
import { Button, Card, ErrorState, LinkButton, PageTitle, SkeletonList } from "@/components/ui";
import type { SearchItem } from "@/server/features/catalog/catalog.service";

interface Page { data: SearchItem[]; meta: { page: number; total: number; hasNext: boolean } }

async function fetchPage(qs: string): Promise<Page> {
  const res = await fetch(`/api/medicines/search?${qs}`, { credentials: "same-origin" });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiClientError(body.message ?? "Something went wrong", res.status);
  return { data: body.data, meta: body.meta };
}

const SORTS = [["RELEVANCE", "Best match"], ["PRICE", "Lowest price"], ["ETA", "Fastest"]] as const;
const RX = [["", "Any"], ["false", "No prescription"], ["true", "Prescription"]] as const;

function MedicineSearch() {
  const router = useRouter();
  const sp = useSearchParams();
  const pincode = useLocation((s) => s.pincode);
  const recent = useRecentSearches();
  const [text, setText] = useState(sp.get("q") ?? "");
  const [q, setQ] = useState(sp.get("q") ?? "");
  const [rx, setRx] = useState(sp.get("rx") ?? "");
  const [available, setAvailable] = useState(sp.get("available") === "1");
  const [sort, setSort] = useState(sp.get("sort") ?? "RELEVANCE");
  const category = sp.get("category") ?? "";

  // The address bar always reflects the search, so a result can be shared or revisited
  useEffect(() => {
    const p = new URLSearchParams();
    if (q) p.set("q", q);
    if (rx) p.set("rx", rx);
    if (available) p.set("available", "1");
    if (sort !== "RELEVANCE") p.set("sort", sort);
    if (category) p.set("category", category);
    router.replace(`/medicines${p.size ? `?${p}` : ""}`, { scroll: false });
  }, [q, rx, available, sort, category, router]);

  const base = new URLSearchParams({ pincode, limit: "12", sort });
  if (q) base.set("q", q);
  if (rx) base.set("prescriptionRequired", rx);
  if (available) base.set("availability", "AVAILABLE");
  if (category) base.set("category", category);
  const results = useInfiniteQuery({
    queryKey: ["catalog-search", base.toString()], initialPageParam: 1,
    queryFn: ({ pageParam }) => fetchPage(`${base}&page=${pageParam}`),
    getNextPageParam: (last) => (last.meta.hasNext ? last.meta.page + 1 : undefined),
    placeholderData: (prev) => prev,
  });
  const items = results.data?.pages.flatMap((p) => p.data) ?? [];
  const total = results.data?.pages[0]?.meta.total ?? 0;

  function submit(v: string) { setQ(v); if (v) recent.remember(v); }

  return (
    <>
      <PageTitle title="Medicines" subtitle="Find a medicine and see which verified pharmacies near you have it." />

      {/* Sticky: the search box and the filters stay in reach while scrolling the results */}
      <div className="sticky top-[4.1rem] z-20 -mx-3 mb-4 space-y-3 border-b border-line bg-canvas/95 px-3 pb-3 pt-1 backdrop-blur sm:-mx-6 sm:px-6">
        <SearchBox value={text} onChange={setText} onSubmit={submit} />
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" role="switch" aria-checked={available} onClick={() => setAvailable((a) => !a)}
            className={clsx("tap inline-flex items-center gap-1.5 rounded-pill border-2 px-4 text-sm", available ? "border-ok bg-ok-50 font-bold text-ok" : "border-line-strong bg-surface font-semibold")}>
            {available && <Check className="size-4" aria-hidden />} Available nearby
          </button>
          <div role="radiogroup" aria-label="Prescription" className="flex gap-1.5">
            {RX.map(([v, l]) => <button key={l} type="button" role="radio" aria-checked={rx === v} onClick={() => setRx(v)} className={clsx("tap rounded-pill border-2 px-3 text-sm", rx === v ? "border-brand-600 bg-brand-50 font-bold" : "border-line-strong bg-surface font-semibold")}>{l}</button>)}
          </div>
          <label className="ml-auto flex items-center gap-2 text-sm font-semibold">Sort
            <select value={sort} onChange={(e) => setSort(e.target.value)} className="tap rounded-control border-2 border-line-strong bg-surface px-2">{SORTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          </label>
        </div>
      </div>

      <div aria-live="polite" className="space-y-3">
        {results.isPending ? <SkeletonList rows={4} lines={3} /> : results.isError ? (
          <ErrorState message={(results.error as Error).message} onRetry={() => void results.refetch()} />
        ) : items.length === 0 ? (
          <NoResult q={q} />
        ) : (
          <>
            <p className="t-caption">{total} {total === 1 ? "medicine" : "medicines"}{q ? ` for “${q}”` : ""} · pincode {pincode}</p>
            <div className="grid gap-3 md:grid-cols-2">{items.map((r) => <SearchResultCard key={r.medicine.id} r={r} />)}</div>
            {results.hasNextPage && <Button variant="secondary" className="w-full" loading={results.isFetchingNextPage} onClick={() => void results.fetchNextPage()}>Show more</Button>}
          </>
        )}
      </div>
    </>
  );
}

/** Nothing matched: three simple ways forward, the last one starts the existing "Find My Medicine" request. */
function NoResult({ q }: { q: string }) {
  return (
    <Card className="space-y-4 text-center">
      <SearchCheck className="mx-auto size-10 text-muted" aria-hidden />
      <div>
        <h2 className="t-section">We couldn&apos;t find this medicine.</h2>
        <p className="t-support">Try one of these.</p>
      </div>
      <ul className="mx-auto grid max-w-md gap-2 text-left">
        <li className="flex items-start gap-3 rounded-control bg-surface-2 p-3"><SpellCheck className="mt-0.5 size-5 shrink-0 text-brand-600" aria-hidden /><span><b>Check the spelling.</b> A few letters off is fine, but try the name on the strip.</span></li>
        <li className="flex items-start gap-3 rounded-control bg-surface-2 p-3"><Type className="mt-0.5 size-5 shrink-0 text-brand-600" aria-hidden /><span><b>Search the generic name.</b> For example “paracetamol” instead of a brand.</span></li>
      </ul>
      <LinkButton href={`/find-medicine${q ? `?q=${encodeURIComponent(q)}` : ""}`} size="lg" className="mx-auto" onClick={() => trackEvent("find_medicine_clicked", { from: "no_result" })}>
        <SearchCheck className="size-5" aria-hidden /> Find This Medicine For Me
      </LinkButton>
      <p className="t-caption">We ask verified pharmacies near you and tell you who has it.</p>
    </Card>
  );
}

export default function MedicinesPage() {
  return <Suspense fallback={<SkeletonList rows={4} lines={3} />}><MedicineSearch /></Suspense>;
}
