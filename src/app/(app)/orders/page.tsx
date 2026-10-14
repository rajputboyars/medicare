"use client";
import Link from "next/link";
import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronRight, Repeat } from "lucide-react";
import clsx from "clsx";
import { api, post } from "@/lib/api";
import { useMe, fmtDateTime } from "@/lib/hooks";
import { inr } from "@/lib/pricing";
import { isFinal } from "@/lib/order-machine";
import { shortStatus } from "@/lib/order-copy";
import { OrderStatusBadge } from "@/components/order/order-status-badge";
import { Button, Card, EmptyState, ErrorState, LinkButton, PageTitle, QueryBoundary, SkeletonList } from "@/components/ui";
import type { Order } from "@/lib/types";

type O = Order & { pharmacy?: { name: string } };
type Tab = "active" | "past";

function OrdersList() {
  const me = useMe();
  const router = useRouter();
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>(useSearchParams().get("tab") === "past" ? "past" : "active");
  const orders = useQuery({ queryKey: ["orders"], queryFn: () => api<O[]>("/api/orders"), enabled: me.data?.role === "CUSTOMER", refetchInterval: 20_000 });
  const repeat = useMutation({
    mutationFn: (id: string) => post<{ id: string }>(`/api/orders/${id}`, { action: "repeat" }),
    onSuccess: (o) => { qc.invalidateQueries({ queryKey: ["orders"] }); router.push(`/orders/${o.id}?placed=1`); },
  });

  if (me.isPending) return <SkeletonList />;
  if (me.data?.role !== "CUSTOMER") return (<><PageTitle title="My Orders" /><EmptyState title="Log in to see your orders" action={<LinkButton href="/login?next=/orders">Log in</LinkButton>} /></>);

  const inTab = (o: O) => (tab === "active") === !isFinal(o.status);
  const count = (t: Tab) => orders.data?.filter((o) => (t === "active") === !isFinal(o.status)).length;
  const tabs: [Tab, string][] = [["active", "Active"], ["past", "Past orders"]];

  return (
    <>
      <PageTitle title="My Orders" action={<LinkButton href="/repeat" variant="secondary"><Repeat className="size-5" aria-hidden /> Repeat Order</LinkButton>} />
      <div role="tablist" aria-label="Order lists" className="mb-4 flex gap-2">
        {tabs.map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
            className={clsx("tap flex-1 rounded-control px-4 font-bold sm:flex-none", tab === k ? "bg-brand-600 text-white" : "border border-line-strong bg-surface")}>
            {l}{count(k) ? ` (${count(k)})` : ""}
          </button>
        ))}
      </div>
      {repeat.isError && <div className="mb-3"><ErrorState message={(repeat.error as Error).message} /></div>}
      <QueryBoundary query={orders} skeleton={<SkeletonList rows={3} lines={4} />} isEmpty={(d) => d.filter(inTab).length === 0}
        empty={<EmptyState title={tab === "active" ? "No active orders" : "No past orders yet"} body={tab === "active" ? "When you place an order, you can follow it here." : "Delivered orders appear here so you can order them again."} action={<LinkButton href="/medicines">Order Medicine</LinkButton>} />}>
        {(list) => (
          <ul className="grid gap-3 md:grid-cols-2">
            {list.filter(inTab).map((o) => (
              <Card as="li" key={o.id} className="space-y-3">
                <Link href={`/orders/${o.id}`} className="block space-y-2">
                  <div className="flex items-start justify-between gap-2"><p className="t-card">{o.code}</p><OrderStatusBadge status={o.status} /></div>
                  <p className="t-support">{!isFinal(o.status) ? shortStatus(o.status) : fmtDateTime(o.createdAt)} · {o.pharmacy?.name}</p>
                  <p className="line-clamp-2">{o.items.map((i) => `${i.name} ×${i.quantity}`).join(", ")}</p>
                  <p className="flex items-center justify-between font-bold"><span>{inr(o.total)}</span><span className="inline-flex items-center text-brand-700">{!isFinal(o.status) ? "Track order" : "Details"} <ChevronRight className="size-4" aria-hidden /></span></p>
                </Link>
                {isFinal(o.status) && <Button variant="secondary" className="w-full" loading={repeat.isPending && repeat.variables === o.id} onClick={() => repeat.mutate(o.id)}><Repeat className="size-5" aria-hidden /> Order again</Button>}
              </Card>
            ))}
          </ul>
        )}
      </QueryBoundary>
    </>
  );
}

export default function Orders() {
  return <Suspense fallback={<SkeletonList />}><OrdersList /></Suspense>;
}
