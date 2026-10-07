"use client";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { inr } from "@/lib/pricing";
import { BarChart } from "@/components/bar-chart";
import { Card, EmptyState, PageTitle, QueryBoundary, SkeletonList, Stat } from "@/components/ui";

interface R {
  days: { label: string; orders: number; gmv: number; cancelled: number }[];
  topPharmacies: { name: string; orders: number; revenue: number }[];
  topMedicines: { name: string; qty: number }[];
  cancellationReasons: { reason: string; count: number }[];
  requests: { total: number; found: number; open: number };
  rxShare: number;
}

export default function AdminReports() {
  const q = useQuery({ queryKey: ["admin-reports"], queryFn: () => api<R>("/api/admin/reports") });
  return (
    <>
      <PageTitle title="Reports" subtitle="Last 7 days and all-time highlights." />
      <QueryBoundary query={q} skeleton={<SkeletonList rows={3} height="h-32" />}>
        {(r) => (
          <>
            <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Stat label="Prescription orders" value={`${r.rxShare}%`} /><Stat label="Medicine requests" value={r.requests.total} />
              <Stat label="Requests found" value={r.requests.found} /><Stat label="Still open" value={r.requests.open} tone={r.requests.open ? "warn" : undefined} />
            </div>
            <div className="mb-6 grid gap-4 lg:grid-cols-2">
              <Card><h2 className="mb-3 text-lg font-extrabold">Orders per day</h2><BarChart label="Orders per day" data={r.days.map((d) => ({ label: d.label, value: d.orders }))} /></Card>
              <Card><h2 className="mb-3 text-lg font-extrabold">GMV per day</h2><BarChart label="GMV per day" data={r.days.map((d) => ({ label: d.label, value: d.gmv }))} format={inr} /></Card>
            </div>
            <div className="grid gap-4 lg:grid-cols-3">
              <Card><h2 className="mb-2 text-lg font-extrabold">Top pharmacies</h2>{r.topPharmacies.length ? <ul className="space-y-1 text-sm">{r.topPharmacies.map((p) => <li key={p.name} className="flex justify-between gap-2"><span>{p.name}</span><b>{inr(p.revenue)}</b></li>)}</ul> : <EmptyState title="No deliveries yet" />}</Card>
              <Card><h2 className="mb-2 text-lg font-extrabold">Top medicines</h2>{r.topMedicines.length ? <ul className="space-y-1 text-sm">{r.topMedicines.map((m) => <li key={m.name} className="flex justify-between gap-2"><span>{m.name}</span><b>{m.qty} units</b></li>)}</ul> : <EmptyState title="No sales yet" />}</Card>
              <Card><h2 className="mb-2 text-lg font-extrabold">Why orders were cancelled</h2>{r.cancellationReasons.length ? <ul className="space-y-1 text-sm">{r.cancellationReasons.map((c) => <li key={c.reason} className="flex justify-between gap-2"><span>{c.reason}</span><b>{c.count}</b></li>)}</ul> : <EmptyState title="No cancellations" />}</Card>
            </div>
          </>
        )}
      </QueryBoundary>
    </>
  );
}
