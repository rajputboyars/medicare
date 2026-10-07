"use client";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { inr } from "@/lib/pricing";
import { BarChart } from "@/components/bar-chart";
import { Card, EmptyState, PageTitle, QueryBoundary, SkeletonList, Stat } from "@/components/ui";

interface R {
  days: { label: string; orders: number; revenue: number }[];
  topMedicines: { name: string; qty: number; revenue: number }[];
  totals: { orders: number; delivered: number; cancelled: number; cancelRate: number };
  rxShare: number; repeatShare: number;
}

export default function Reports() {
  const q = useQuery({ queryKey: ["pharmacy-reports"], queryFn: () => api<R>("/api/pharmacy/reports") });
  return (
    <>
      <PageTitle title="Reports" subtitle="How your pharmacy is doing on the platform." />
      <QueryBoundary query={q} skeleton={<SkeletonList rows={3} height="h-32" />}>
        {(r) => (
          <>
            <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Stat label="Orders (all time)" value={r.totals.orders} /><Stat label="Delivered" value={r.totals.delivered} />
              <Stat label="Cancelled" value={`${r.totals.cancelled} (${r.totals.cancelRate}%)`} tone={r.totals.cancelRate > 20 ? "warn" : undefined} /><Stat label="Prescription orders" value={`${r.rxShare}%`} />
            </div>
            <Card className="mb-6"><h2 className="mb-3 text-lg font-extrabold">Revenue, last 7 days</h2><BarChart label="Daily revenue" data={r.days.map((d) => ({ label: d.label, value: d.revenue }))} format={inr} /></Card>
            <Card className="mb-6"><h2 className="mb-3 text-lg font-extrabold">Orders, last 7 days</h2><BarChart label="Daily orders" data={r.days.map((d) => ({ label: d.label, value: d.orders }))} /></Card>
            <h2 className="mb-3 text-xl font-extrabold">Top medicines</h2>
            {r.topMedicines.length === 0 ? <EmptyState title="No sales yet" /> : (
              <Card className="overflow-x-auto p-0 sm:p-0"><table className="w-full min-w-[24rem] text-left text-sm"><thead className="bg-stone-50 text-muted"><tr><th className="p-3">Medicine</th><th>Units</th><th>Revenue</th></tr></thead>
                <tbody>{r.topMedicines.map((m) => <tr key={m.name} className="border-t border-line"><td className="p-3 font-semibold">{m.name}</td><td>{m.qty}</td><td>{inr(m.revenue)}</td></tr>)}</tbody></table></Card>
            )}
            <p className="mt-4 text-sm text-muted">{r.repeatShare}% of your orders were one-tap repeats: your regular customers come back.</p>
          </>
        )}
      </QueryBoundary>
    </>
  );
}
