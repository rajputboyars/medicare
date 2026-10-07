"use client";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { inr } from "@/lib/pricing";
import { Card, PageTitle, QueryBoundary, SkeletonList, Stat } from "@/components/ui";

interface S {
  ordersToday: number; gmv: number; customers: number; activePharmacies: number; pendingPharmacyApprovals: number; ridersOnline: number; ridersVerified: number;
  pendingRiderApprovals: number; deliveries: number; cancelledOrders: number; liveOrders: number; openRequests: number; openTickets: number; pendingSettlements: number;
}

export default function AdminHome() {
  const q = useQuery({ queryKey: ["admin-stats"], queryFn: () => api<S>("/api/admin/stats"), refetchInterval: 30_000 });
  return (
    <>
      <PageTitle title="Platform dashboard" subtitle="Live overview of orders, partners and approvals." />
      <QueryBoundary query={q} skeleton={<SkeletonList rows={3} height="h-24" />}>
        {(s) => (
          <>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Link href="/admin/orders"><Stat label="Orders today" value={s.ordersToday} /></Link>
              <Link href="/admin/orders"><Stat label="Live orders now" value={s.liveOrders} /></Link>
              <Link href="/admin/payments"><Stat label="GMV (excl. cancelled)" value={inr(s.gmv)} /></Link>
              <Link href="/admin/customers"><Stat label="Customers" value={s.customers} /></Link>
              <Link href="/admin/pharmacies"><Stat label="Active pharmacies" value={s.activePharmacies} /></Link>
              <Link href="/admin/verification"><Stat label="Pharmacy approvals pending" value={s.pendingPharmacyApprovals} tone={s.pendingPharmacyApprovals ? "warn" : undefined} /></Link>
              <Link href="/admin/riders"><Stat label="Riders online" value={`${s.ridersOnline} / ${s.ridersVerified}`} /></Link>
              <Link href="/admin/verification"><Stat label="Rider approvals pending" value={s.pendingRiderApprovals} tone={s.pendingRiderApprovals ? "warn" : undefined} /></Link>
              <Stat label="Deliveries completed" value={s.deliveries} />
              <Stat label="Cancelled orders" value={s.cancelledOrders} />
              <Link href="/admin/requests"><Stat label="Open medicine requests" value={s.openRequests} tone={s.openRequests ? "warn" : undefined} /></Link>
              <Link href="/admin/complaints"><Stat label="Open complaints" value={s.openTickets} tone={s.openTickets ? "warn" : undefined} /></Link>
            </div>
            <Card className="mt-5 flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-lg font-extrabold">Settlements</h2><p className="text-muted">{s.pendingSettlements} settlement(s) waiting to be processed or paid.</p></div>
              <Link href="/admin/settlements" className="inline-flex min-h-12 items-center rounded-2xl bg-brand-600 px-5 font-semibold text-white">Open settlements</Link></Card>
          </>
        )}
      </QueryBoundary>
    </>
  );
}
