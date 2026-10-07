"use client";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { fmtDateTime } from "@/lib/hooks";
import { inr } from "@/lib/pricing";
import { Card, EmptyState, PageTitle, QueryBoundary, SkeletonList } from "@/components/ui";

interface H { id: string; orderCode: string; area: string; payout: number; cashCollected: number; deliveredAt: string }

export default function RiderHistory() {
  const q = useQuery({ queryKey: ["rider-history"], queryFn: () => api<H[]>("/api/delivery/history") });
  return (
    <>
      <PageTitle title="Delivery history" />
      <QueryBoundary query={q} skeleton={<SkeletonList rows={4} height="h-20" />} isEmpty={(d) => d.length === 0} empty={<EmptyState title="No completed deliveries yet" body="Finished deliveries show up here." />}>
        {(list) => (
          <ul className="space-y-2">{list.map((h) => (
            <Card as="li" key={h.id} className="flex items-center justify-between gap-3"><div><p className="font-bold">{h.orderCode}</p><p className="text-sm text-muted">{h.area} · {fmtDateTime(h.deliveredAt)}</p>{h.cashCollected > 0 && <p className="text-xs text-warn">Cash collected {inr(h.cashCollected)}</p>}</div><p className="text-lg font-extrabold text-ok">+{inr(h.payout)}</p></Card>
          ))}</ul>
        )}
      </QueryBoundary>
    </>
  );
}
