"use client";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { fmtDate } from "@/lib/hooks";
import { inr } from "@/lib/pricing";
import { Badge, Card, EmptyState, PageTitle, QueryBoundary, SkeletonList } from "@/components/ui";

interface C { id: string; name: string; mobile: string; area: string; orders: number; delivered: number; spent: number; lastOrderAt: string; repeatCustomer: boolean }

export default function Customers() {
  const q = useQuery({ queryKey: ["pharmacy-customers"], queryFn: () => api<C[]>("/api/pharmacy/customers") });
  return (
    <>
      <PageTitle title="Customers" subtitle="People who ordered from your pharmacy. Phone numbers are masked for privacy; call from an order when needed." />
      <QueryBoundary query={q} skeleton={<SkeletonList rows={4} height="h-14" />} isEmpty={(d) => d.length === 0} empty={<EmptyState title="No customers yet" body="They appear after the first order." />}>
        {(rows) => (
          <Card className="overflow-x-auto p-0 sm:p-0">
            <table className="w-full min-w-[40rem] text-left text-sm">
              <thead className="bg-stone-50 text-muted"><tr><th className="p-3">Customer</th><th>Area</th><th>Orders</th><th>Spent</th><th>Last order</th></tr></thead>
              <tbody>{rows.map((c) => (
                <tr key={c.id} className="border-t border-line">
                  <td className="p-3"><b>{c.name}</b> {c.repeatCustomer && <Badge tone="green">Repeat</Badge>}<br /><span className="text-muted">{c.mobile}</span></td>
                  <td>{c.area}</td><td>{c.delivered}/{c.orders} delivered</td><td>{inr(c.spent)}</td><td>{fmtDate(c.lastOrderAt)}</td>
                </tr>))}</tbody>
            </table>
          </Card>
        )}
      </QueryBoundary>
    </>
  );
}
