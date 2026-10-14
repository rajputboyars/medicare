"use client";
import { useState } from "react";
import clsx from "clsx";
import { GROUPS, OrderQueue, usePharmacyOrders, type Group } from "@/components/pharmacy/order-queue";
import { PageTitle } from "@/components/ui";

const TABS: [Group, string][] = [["new", "New"], ["review", "Prescriptions"], ["progress", "In progress"], ["ready", "Ready for pickup"], ["history", "History"]];

export default function PharmacyOrders() {
  const [g, setG] = useState<Group>("new");
  const q = usePharmacyOrders();
  const count = (k: Group) => q.data?.filter((o) => (GROUPS[k] as readonly string[]).includes(o.status)).length;
  return (
    <>
      <PageTitle title="Orders" subtitle="Accept, prepare, then mark ready. Delivery partners pick up ready orders." />
      <div role="tablist" aria-label="Order groups" className="mb-4 flex gap-2 overflow-x-auto pb-1">
        {TABS.map(([k, l]) => (
          <button key={k} role="tab" aria-selected={g === k} onClick={() => setG(k)}
            className={clsx("tap shrink-0 rounded-pill px-5 font-bold", g === k ? "bg-brand-600 text-white" : "border border-line-strong bg-surface hover:bg-surface-2")}>
            {l}{count(k) ? ` (${count(k)})` : ""}
          </button>
        ))}
      </div>
      <OrderQueue group={g} />
    </>
  );
}
