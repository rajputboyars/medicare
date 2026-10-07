"use client";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { inr } from "@/lib/pricing";
import { BarChart } from "@/components/bar-chart";
import { Card, Notice, PageTitle, QueryBoundary, SkeletonList, Stat } from "@/components/ui";

interface E { today: { amount: number; count: number }; week: { amount: number; count: number }; total: { amount: number; count: number }; cashCollectedToday: number; days: { label: string; amount: number; count: number }[] }

export default function RiderEarnings() {
  const q = useQuery({ queryKey: ["rider-earnings"], queryFn: () => api<E>("/api/delivery/earnings") });
  return (
    <>
      <PageTitle title="Earnings" />
      <QueryBoundary query={q} skeleton={<SkeletonList rows={3} height="h-24" />}>
        {(e) => (
          <>
            <div className="mb-4 grid grid-cols-2 gap-3">
              <Stat label="Today" value={`${inr(e.today.amount)}`} /><Stat label="Deliveries today" value={e.today.count} />
              <Stat label="Last 7 days" value={inr(e.week.amount)} /><Stat label="All time" value={inr(e.total.amount)} />
            </div>
            <Card className="mb-4"><h2 className="mb-3 text-lg font-extrabold">Last 7 days</h2><BarChart label="Daily earnings" data={e.days.map((d) => ({ label: d.label, value: d.amount }))} format={inr} /></Card>
            {e.cashCollectedToday > 0 && <Notice tone="amber" title={`Cash in hand today: ${inr(e.cashCollectedToday)}`}>This is customer cash from COD deliveries. Deposit it as instructed by the platform.</Notice>}
            <p className="mt-4 text-sm text-muted">Payouts are settled by the platform team. {e.total.count} deliveries completed so far.</p>
          </>
        )}
      </QueryBoundary>
    </>
  );
}
