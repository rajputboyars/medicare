"use client";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { inr } from "@/lib/pricing";
import { OrderQueue } from "@/components/pharmacy/order-queue";
import { Badge, Notice, PageTitle, QueryBoundary, SkeletonList, Stat } from "@/components/ui";
import type { Pharmacy } from "@/lib/types";

interface Stats { pharmacy: Pharmacy; toReview: number; newOrders: number; inProgress: number; deliveredToday: number; revenueToday: number; revenueTotal: number; lowStock: number; openRequests: number }

export default function PharmacyDashboard() {
  const q = useQuery({ queryKey: ["pharmacy-dashboard"], queryFn: () => api<Stats>("/api/pharmacy/dashboard"), refetchInterval: 20_000 });
  return (
    <>
      <QueryBoundary query={q} skeleton={<SkeletonList rows={2} height="h-24" />}>
        {(s) => (
          <>
            <PageTitle title={s.pharmacy.name} subtitle={`Drug licence ${s.pharmacy.drugLicense}`} action={<Badge tone={s.pharmacy.verification === "VERIFIED" ? "green" : "amber"}>{s.pharmacy.verification.toLowerCase()}</Badge>} />
            {s.pharmacy.verification !== "VERIFIED" && <div className="mb-4"><Notice tone="amber" title="Verification pending">You can set up inventory now. Customers can order once the platform team verifies your licence.</Notice></div>}
            {!s.pharmacy.acceptingOrders && s.pharmacy.verification === "VERIFIED" && <div className="mb-4"><Notice tone="amber" title="You are not accepting orders">Turn this on in Settings.</Notice></div>}
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Link href="/pharmacy/prescriptions"><Stat label="Prescriptions to verify" value={s.toReview} tone={s.toReview ? "warn" : undefined} /></Link>
              <Link href="/pharmacy/orders"><Stat label="New orders" value={s.newOrders} tone={s.newOrders ? "warn" : undefined} /></Link>
              <Stat label="In progress" value={s.inProgress} />
              <Stat label="Delivered today" value={s.deliveredToday} />
              <Stat label="Revenue today" value={inr(s.revenueToday)} />
              <Stat label="Revenue (all delivered)" value={inr(s.revenueTotal)} />
              <Link href="/pharmacy/inventory"><Stat label="Low-stock alerts" value={`${s.lowStock} items`} tone={s.lowStock ? "warn" : undefined} /></Link>
              <Link href="/pharmacy/requests"><Stat label="Customers asking for a medicine" value={`${s.openRequests} open`} tone={s.openRequests ? "warn" : undefined} /></Link>
            </div>
          </>
        )}
      </QueryBoundary>
      <h2 className="mb-3 mt-8 text-xl font-extrabold">Needs your action</h2>
      <h3 className="mb-2 text-sm font-bold uppercase tracking-wide text-muted">Prescriptions to verify</h3>
      <OrderQueue group="review" limit={3} />
      <h3 className="mb-2 mt-6 text-sm font-bold uppercase tracking-wide text-muted">New orders</h3>
      <OrderQueue group="new" limit={3} />
    </>
  );
}
