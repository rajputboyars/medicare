"use client";
import { useQuery } from "@tanstack/react-query";
import { ClipboardList, FileCheck2, PackageMinus, PackageCheck, Search } from "lucide-react";
import { api } from "@/lib/api";
import { inr } from "@/lib/pricing";
import { OrderQueue } from "@/components/pharmacy/order-queue";
import type { PharmacyStats } from "./layout";
import { DashboardMetricCard, OperationalAlert, PageTitle, QueryBoundary, SectionHeader, SkeletonMetric, StatusBadge } from "@/components/ui";
import type { MetricTone } from "@/components/ui/dashboard-metric-card";

const tone = (n: number, danger = false): MetricTone => (n > 0 ? (danger ? "danger" : "attention") : "neutral");

/** Operational first: what needs an answer right now. Numbers and charts live in Reports. */
export default function PharmacyDashboard() {
  const q = useQuery({ queryKey: ["pharmacy-dashboard"], queryFn: () => api<PharmacyStats>("/api/pharmacy/dashboard"), refetchInterval: 20_000 });
  return (
    <QueryBoundary query={q} skeleton={<div className="grid grid-cols-2 gap-3 lg:grid-cols-5"><SkeletonMetric /><SkeletonMetric /><SkeletonMetric /><SkeletonMetric /><SkeletonMetric /></div>}>
      {(s) => (
        <>
          <PageTitle title={s.pharmacy.name} subtitle={`Drug licence ${s.pharmacy.drugLicense}`}
            action={<StatusBadge tone={s.pharmacy.verification === "VERIFIED" ? "success" : "warning"}>{s.pharmacy.verification === "VERIFIED" ? "Verified pharmacy" : `Verification ${s.pharmacy.verification.toLowerCase()}`}</StatusBadge>} />

          <div className="mb-5 space-y-3 empty:hidden">
            {s.pharmacy.verification !== "VERIFIED" && <OperationalAlert severity="warning" title="Your pharmacy is waiting for verification" description="You can set up your stock now. Customers can order once the DawaDost team verifies your licence." />}
            {!s.pharmacy.acceptingOrders && s.pharmacy.verification === "VERIFIED" && <OperationalAlert severity="critical" title="You are not accepting orders" description="Customers cannot order from you right now." action={{ label: "Turn on", href: "/pharmacy/settings" }} />}
          </div>

          <section aria-labelledby="now"><SectionHeader id="now" title="Needs your attention" />
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
              <DashboardMetricCard href="/pharmacy/orders" icon={<ClipboardList />} label="New orders" value={s.newOrders} tone={tone(s.newOrders)} hint={s.newOrders ? "Waiting for you to accept" : "All answered"} />
              <DashboardMetricCard href="/pharmacy/prescriptions" icon={<FileCheck2 />} label="Prescription reviews" value={s.toReview} tone={tone(s.toReview)} hint={s.toReview ? "Please verify" : "None waiting"} />
              <DashboardMetricCard href="/pharmacy/requests" icon={<Search />} label="Medicine requests" value={s.openRequests} tone={tone(s.openRequests)} hint={s.openRequests ? "Customers need an answer" : "None open"} />
              <DashboardMetricCard href="/pharmacy/inventory" icon={<PackageMinus />} label="Low stock" value={s.lowStock} tone={tone(s.lowStock)} hint={s.lowStock ? "Restock soon" : "Stock looks fine"} />
              <DashboardMetricCard href="/pharmacy/orders" icon={<PackageCheck />} label="Ready for pickup" value={s.readyForPickup} tone={s.readyForPickup ? "success" : "neutral"} hint={s.readyForPickup ? "Waiting for a delivery partner" : "None waiting"} />
            </div>
          </section>

          <section aria-labelledby="today" className="mt-6"><SectionHeader id="today" title="Today" href="/pharmacy/reports" linkLabel="Reports" />
            <div className="grid grid-cols-3 gap-3">
              <DashboardMetricCard label="In progress" value={s.inProgress} />
              <DashboardMetricCard label="Delivered today" value={s.deliveredToday} />
              <DashboardMetricCard label="Sales today" value={inr(s.revenueToday)} />
            </div>
          </section>
      <div className="mt-8 grid gap-8">
        <section aria-labelledby="rx-feed"><SectionHeader id="rx-feed" title="Prescriptions to review" href="/pharmacy/prescriptions" /><OrderQueue group="review" limit={2} /></section>
        <section aria-labelledby="new-feed"><SectionHeader id="new-feed" title="New orders" href="/pharmacy/orders" /><OrderQueue group="new" limit={2} /></section>
      </div>
        </>
      )}
    </QueryBoundary>
  );
}
