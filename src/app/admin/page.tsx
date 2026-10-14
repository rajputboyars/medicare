"use client";
import { useQuery } from "@tanstack/react-query";
import { Bike, ClipboardList, IndianRupee, ShieldCheck, Store, Users } from "lucide-react";
import { api } from "@/lib/api";
import { inr } from "@/lib/pricing";
import { DashboardMetricCard, OperationalAlert, PageTitle, QueryBoundary, SectionHeader, SkeletonMetric, Success } from "@/components/ui";
import type { AdminStats } from "./layout";

export default function AdminHome() {
  const q = useQuery({ queryKey: ["admin-stats"], queryFn: () => api<AdminStats>("/api/admin/stats"), refetchInterval: 30_000 });
  return (
    <>
      <PageTitle title="Dashboard" subtitle="What is happening on DawaDost right now." />
      <QueryBoundary query={q} skeleton={<div className="grid grid-cols-2 gap-3 xl:grid-cols-3"><SkeletonMetric /><SkeletonMetric /><SkeletonMetric /><SkeletonMetric /><SkeletonMetric /><SkeletonMetric /></div>}>
        {(s) => (
          <>
            <div className="grid grid-cols-2 gap-3 xl:grid-cols-3">
              <DashboardMetricCard href="/admin/orders" icon={<ClipboardList />} label="Orders today" value={s.ordersToday} hint={`${s.liveOrders} in progress now`} />
              <DashboardMetricCard href="/admin/payments" icon={<IndianRupee />} label="GMV (not cancelled)" value={inr(s.gmv)} hint={`${s.deliveries} delivered`} />
              <DashboardMetricCard href="/admin/customers" icon={<Users />} label="Customers" value={s.customers} />
              <DashboardMetricCard href="/admin/pharmacies" icon={<Store />} label="Pharmacies" value={s.activePharmacies} hint="Verified and active" />
              <DashboardMetricCard href="/admin/riders" icon={<Bike />} label="Delivery partners" value={`${s.ridersOnline} / ${s.ridersVerified}`} hint="Online / verified" />
              <DashboardMetricCard href="/admin/verification" icon={<ShieldCheck />} label="Pending approvals" value={s.pendingApprovals} tone={s.pendingApprovals ? "attention" : "neutral"} hint={s.pendingApprovals ? "Pharmacies and delivery partners" : "Nothing waiting"} />
            </div>

            <section aria-labelledby="att" className="mt-8"><SectionHeader id="att" title="Attention required" />
              {s.attention.length === 0 ? <Success title="All clear">Nothing needs your attention right now.</Success> : (
                <ul className="space-y-3">{s.attention.map((a) => (
                  <li key={a.id}><OperationalAlert severity={a.severity} title={a.title} description={a.description} action={{ label: a.actionLabel, href: a.href }} /></li>
                ))}</ul>
              )}
            </section>
          </>
        )}
      </QueryBoundary>
    </>
  );
}
