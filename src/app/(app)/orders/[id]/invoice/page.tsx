"use client";
import { use } from "react";
import { useQuery } from "@tanstack/react-query";
import { Printer } from "lucide-react";
import { api } from "@/lib/api";
import { fmtDateTime } from "@/lib/hooks";
import { inr } from "@/lib/pricing";
import { Button, QueryBoundary, SkeletonList } from "@/components/ui";
import type { Order } from "@/lib/types";

type O = Order & { pharmacy?: { name: string; address: string } };

export default function Invoice({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const q = useQuery({ queryKey: ["order", id], queryFn: () => api<O>(`/api/orders/${id}`) });
  return (
    <QueryBoundary query={q} skeleton={<SkeletonList />}>
      {(o) => (
        <article className="mx-auto max-w-2xl rounded-2xl border border-line bg-white p-6">
          <div className="no-print mb-4 flex justify-end"><Button onClick={() => window.print()}><Printer className="size-5" aria-hidden /> Print / Save as PDF</Button></div>
          <header className="mb-4 border-b border-line pb-4">
            <h1 className="text-2xl font-extrabold">Order receipt</h1>
            <p className="text-sm text-muted">Receipt for order {o.code} · {fmtDateTime(o.createdAt)}</p>
            <p className="mt-2 font-semibold">Sold by: {o.pharmacy?.name}</p><p className="text-sm text-muted">{o.pharmacy?.address}</p>
            <p className="mt-2 text-sm">Deliver to: {o.addressSnapshot.contactName}, {o.addressSnapshot.area}, {o.addressSnapshot.town} – {o.addressSnapshot.pincode}</p>
          </header>
          <table className="w-full text-left text-sm">
            <thead><tr className="border-b border-line"><th className="py-2">Item</th><th>Qty</th><th className="text-right">MRP</th><th className="text-right">Price</th><th className="text-right">Amount</th></tr></thead>
            <tbody>{o.items.map((i) => <tr key={i.id} className="border-b border-line/60"><td className="py-2">{i.name} <span className="text-muted">{i.strength}</span></td><td>{i.quantity}</td><td className="text-right">{inr(i.mrp)}</td><td className="text-right">{inr(i.unitPrice)}</td><td className="text-right">{inr(i.unitPrice * i.quantity)}</td></tr>)}</tbody>
          </table>
          <dl className="ml-auto mt-4 w-64 space-y-1 text-sm">
            <div className="flex justify-between"><dt>Subtotal</dt><dd>{inr(o.subtotal)}</dd></div>
            <div className="flex justify-between"><dt>Delivery</dt><dd>{o.deliveryFee ? inr(o.deliveryFee) : "Free"}</dd></div>
            {o.discount > 0 && <div className="flex justify-between"><dt>Discount</dt><dd>−{inr(o.discount)}</dd></div>}
            <div className="flex justify-between border-t border-line pt-1 text-base font-extrabold"><dt>Total</dt><dd>{inr(o.total)}</dd></div>
            <div className="flex justify-between text-muted"><dt>Payment</dt><dd>{o.paymentMethod} ({o.paymentStatus.replace("_", " ").toLowerCase()})</dd></div>
          </dl>
          <p className="mt-6 text-xs text-muted">This is a system-generated receipt. Tax invoice details (GSTIN, batch &amp; expiry) are issued by the pharmacy as required by law.</p>
        </article>
      )}
    </QueryBoundary>
  );
}
