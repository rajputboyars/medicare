"use client";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Card, DashboardMetricCard, Notice, PageTitle, QueryBoundary, SectionHeader, SkeletonList } from "@/components/ui";

interface Insights {
  periodDays: number; totalSearches: number; noResultRate: number; note: string;
  topSearched: { query: string; count: number }[]; highNoResult: { query: string; count: number }[];
  poorAvailabilityAreas: { pincode: string; district?: string; pharmacies: number; medicinesAvailable: number; catalogueSize: number; coveragePercent: number; searches: number; noResultSearches: number }[];
  lowStock: { currentLowLines: number; mostOftenLow: { query: string; count: number }[] };
  medicineRequests: { total: number; answeredAvailable: number; ordered: number; answerRate: number; conversionRate: number };
  funnel: Record<string, number>;
}

const Bars = ({ rows, empty }: { rows: { query: string; count: number }[]; empty: string }) => rows.length === 0 ? <p className="t-caption">{empty}</p> : (
  <ol className="space-y-1.5">{rows.map((r) => (
    <li key={r.query} className="flex items-center gap-3 text-sm"><span className="w-40 shrink-0 truncate font-semibold">{r.query}</span>
      <span className="h-2 flex-1 overflow-hidden rounded-pill bg-line" aria-hidden><span className="block h-full rounded-pill bg-brand-600" style={{ width: `${Math.max(6, (r.count / rows[0].count) * 100)}%` }} /></span>
      <span className="t-number w-8 text-right">{r.count}</span></li>))}</ol>
);

/** What people search for and where we fall short. Counts only: these describe coverage, they are not medical advice. */
export default function CatalogInsights() {
  const q = useQuery({ queryKey: ["admin", "insights"], queryFn: () => api<Insights>("/api/admin/catalog-insights?days=30"), refetchInterval: 60_000 });
  return (
    <>
      <PageTitle title="Search insights" subtitle="Last 30 days. What customers look for, and where stock or catalogue is missing." />
      <QueryBoundary query={q} skeleton={<SkeletonList rows={3} lines={4} />}>
        {(s) => (
          <>
            <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
              <DashboardMetricCard label="Searches" value={s.totalSearches} />
              <DashboardMetricCard label="Found nothing" value={`${s.noResultRate}%`} tone={s.noResultRate > 20 ? "attention" : "neutral"} hint="Of all searches" />
              <DashboardMetricCard label="Low-stock lines now" value={s.lowStock.currentLowLines} tone={s.lowStock.currentLowLines ? "attention" : "neutral"} />
              <DashboardMetricCard label="Requests that ordered" value={`${s.medicineRequests.conversionRate}%`} hint={`${s.medicineRequests.ordered} of ${s.medicineRequests.answeredAvailable} answered`} />
            </div>
            <div className="mt-6 grid gap-4 lg:grid-cols-2">
              <Card><SectionHeader id="top" title="Most searched" /><Bars rows={s.topSearched} empty="No searches yet." /></Card>
              <Card><SectionHeader id="none" title="Searches with no result" /><Bars rows={s.highNoResult} empty="Every search found something." /></Card>
              <Card><SectionHeader id="low" title="Most often low on stock" /><Bars rows={s.lowStock.mostOftenLow} empty="No stock alerts recorded." /></Card>
              <Card>
                <SectionHeader id="areas" title="Areas with the thinnest availability" />
                {s.poorAvailabilityAreas.length === 0 ? <p className="t-caption">No live areas yet.</p> : (
                  <ul className="space-y-2 text-sm">{s.poorAvailabilityAreas.map((a) => (
                    <li key={a.pincode} className="flex flex-wrap items-center justify-between gap-2"><span><b>{a.pincode}</b> {a.district} · {a.pharmacies} pharmacies</span>
                      <span>{a.medicinesAvailable}/{a.catalogueSize} medicines ({a.coveragePercent}%){a.noResultSearches ? ` · ${a.noResultSearches} empty searches` : ""}</span></li>))}</ul>
                )}
              </Card>
            </div>
            <Card className="mt-4"><SectionHeader id="funnel" title="From search to cart" />
              <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">{Object.entries(s.funnel).map(([k, v]) => <div key={k}><dt className="t-caption">{k.replace(/_/g, " ")}</dt><dd className="t-number text-xl">{v}</dd></div>)}</dl>
            </Card>
            <div className="mt-4"><Notice tone="blue">{s.note}</Notice></div>
          </>
        )}
      </QueryBoundary>
    </>
  );
}
