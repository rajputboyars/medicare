"use client";
import Link from "next/link";
import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Repeat } from "lucide-react";
import { api, post } from "@/lib/api";
import { useMe, fmtDateTime } from "@/lib/hooks";
import { inr } from "@/lib/pricing";
import { STATUS_LABEL, isFinal, statusTone } from "@/lib/order-machine";
import { Badge, Button, Card, EmptyState, ErrorState, LinkButton, PageTitle, QueryBoundary, SkeletonList } from "@/components/ui";
import type { Order } from "@/lib/types";

type O = Order & { pharmacy?: { name: string } };
type Tab = "active" | "past";

function OrdersList() {
  const me = useMe();
  const router = useRouter();
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>(useSearchParams().get("tab") === "past" ? "past" : "active");
  const orders = useQuery({ queryKey: ["orders"], queryFn: () => api<O[]>("/api/orders"), enabled: !!me.data, refetchInterval: 20_000 });
  const repeat = useMutation({
    mutationFn: (id: string) => post<{ id: string }>(`/api/orders/${id}`, { action: "repeat" }),
    onSuccess: (o) => { qc.invalidateQueries({ queryKey: ["orders"] }); router.push(`/orders/${o.id}?placed=1`); },
  });

  if (me.isPending) return <SkeletonList />;
  if (!me.data) return (<><PageTitle title="My Orders" /><EmptyState title="Log in to see your orders" action={<LinkButton href="/login?next=/orders">Log in</LinkButton>} /></>);

  const tabs: [Tab, string][] = [["active", "Active"], ["past", "Previous orders"]];
  const inTab = (o: O) => (tab === "active") === !isFinal(o.status);
  return (
    <>
      <PageTitle title="My Orders" action={<LinkButton href="/repeat" variant="secondary"><Repeat className="size-5" aria-hidden /> Repeat Order</LinkButton>} />
      <div role="tablist" aria-label="Order types" className="mb-4 flex gap-2 overflow-x-auto">
        {tabs.map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={`min-h-12 shrink-0 rounded-2xl px-4 font-bold ${tab === k ? "bg-brand-600 text-white" : "border border-line bg-white"}`}>{l}</button>)}
      </div>
      {repeat.isError && <div className="mb-3"><ErrorState message={(repeat.error as Error).message} /></div>}
      <QueryBoundary query={orders} skeleton={<SkeletonList rows={3} />} isEmpty={(d) => d.filter(inTab).length === 0}
        empty={<EmptyState title={tab === "active" ? "No active orders" : "No previous orders yet"} body="Your medicine orders will show up here." action={<LinkButton href="/medicines">Order Medicine</LinkButton>} />}>
        {(list) => (
          <ul className="space-y-3">
            {list.filter(inTab).map((o) => (
              <Card as="li" key={o.id} className="space-y-3">
                <Link href={`/orders/${o.id}`} className="block space-y-2">
                  <div className="flex items-start justify-between gap-2"><p className="text-lg font-bold">{o.code}</p><Badge tone={statusTone(o.status)}>{STATUS_LABEL[o.status]}</Badge></div>
                  <p className="text-sm text-muted">{o.pharmacy?.name} · {fmtDateTime(o.createdAt)}</p>
                  <p className="line-clamp-2">{o.items.map((i) => `${i.name} ×${i.quantity}`).join(", ")}</p>
                  <p className="flex justify-between font-bold"><span>{inr(o.total)}</span>{!isFinal(o.status) && <span className="text-brand-700">Track order →</span>}</p>
                </Link>
                {isFinal(o.status) && (
                  <Button variant="secondary" className="w-full sm:w-auto" loading={repeat.isPending && repeat.variables === o.id} onClick={() => repeat.mutate(o.id)}><Repeat className="size-5" aria-hidden /> Reorder in one tap</Button>
                )}
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
