"use client";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { fmtDate, fmtDateTime } from "@/lib/hooks";
import { inr } from "@/lib/pricing";
import { Badge, Card, EmptyState, PageTitle, QueryBoundary, SkeletonList, Stat } from "@/components/ui";
import type { Payment, Settlement } from "@/lib/types";

interface Data { totals: { paid: number; codDue: number; pendingOnline: number; refunded: number }; payments: (Payment & { orderCode: string })[]; settlements: Settlement[] }
const tone = { PAID: "green", COD_DUE: "amber", PENDING: "amber", REFUNDED: "gray", FAILED: "red" } as const;

export default function Payments() {
  const q = useQuery({ queryKey: ["pharmacy-payments"], queryFn: () => api<Data>("/api/pharmacy/payments") });
  return (
    <>
      <PageTitle title="Payments & settlements" subtitle="What customers paid, cash still to be collected by riders, and your payouts after the platform commission." />
      <QueryBoundary query={q} skeleton={<SkeletonList rows={3} height="h-20" />}>
        {(d) => (
          <>
            <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Stat label="Paid" value={inr(d.totals.paid)} /><Stat label="COD to be collected" value={inr(d.totals.codDue)} tone={d.totals.codDue ? "warn" : undefined} />
              <Stat label="Online, awaiting payment" value={inr(d.totals.pendingOnline)} /><Stat label="Refunded" value={inr(d.totals.refunded)} />
            </div>
            <h2 className="mb-3 text-xl font-extrabold">Settlements</h2>
            {d.settlements.length === 0 ? <EmptyState title="No settlements yet" body="The platform creates a settlement for delivered orders." /> : (
              <Card className="mb-6 overflow-x-auto p-0 sm:p-0"><table className="w-full min-w-[34rem] text-left text-sm">
                <thead className="bg-stone-50 text-muted"><tr><th className="p-3">Period</th><th>Orders</th><th>Gross</th><th>Commission</th><th>Net payout</th><th>Status</th></tr></thead>
                <tbody>{d.settlements.map((x) => <tr key={x.id} className="border-t border-line"><td className="p-3">{fmtDate(x.periodStart)} – {fmtDate(x.periodEnd)}</td><td>{x.orderCount}</td><td>{inr(x.gross)}</td><td>{inr(x.commission)}</td><td className="font-bold">{inr(x.net)}</td><td><Badge tone={x.status === "PAID" ? "green" : "amber"}>{x.status.toLowerCase()}</Badge></td></tr>)}</tbody></table></Card>
            )}
            <h2 className="mb-3 text-xl font-extrabold">Payments</h2>
            {d.payments.length === 0 ? <EmptyState title="No payments yet" /> : (
              <Card className="overflow-x-auto p-0 sm:p-0"><table className="w-full min-w-[34rem] text-left text-sm">
                <thead className="bg-stone-50 text-muted"><tr><th className="p-3">Order</th><th>Method</th><th>Amount</th><th>Status</th><th>When</th></tr></thead>
                <tbody>{d.payments.map((p) => <tr key={p.id} className="border-t border-line"><td className="p-3 font-semibold">{p.orderCode}</td><td>{p.method}</td><td>{inr(p.amount)}</td><td><Badge tone={tone[p.status]}>{p.status.replace("_", " ").toLowerCase()}</Badge></td><td>{fmtDateTime(p.createdAt)}</td></tr>)}</tbody></table></Card>
            )}
          </>
        )}
      </QueryBoundary>
    </>
  );
}
