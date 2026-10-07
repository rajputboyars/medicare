"use client";
import { useState } from "react";
import { GROUPS, OrderQueue, usePharmacyOrders, type Group } from "@/components/pharmacy/order-queue";
import { PageTitle } from "@/components/ui";

const TABS: [Group, string][] = [["new", "New"], ["review", "Prescription review"], ["progress", "In progress"], ["history", "History"]];

export default function PharmacyOrders() {
  const [g, setG] = useState<Group>("new");
  const q = usePharmacyOrders();
  const count = (k: Group) => q.data?.filter((o) => (GROUPS[k] as readonly string[]).includes(o.status)).length;
  return (
    <>
      <PageTitle title="Orders" subtitle="Move each order forward: confirm → prepare → ready for pickup. Riders accept ready orders from their app." />
      <div role="tablist" aria-label="Order groups" className="mb-4 flex gap-2 overflow-x-auto">
        {TABS.map(([k, l]) => (
          <button key={k} role="tab" aria-selected={g === k} onClick={() => setG(k)} className={`min-h-12 shrink-0 rounded-2xl px-5 font-bold ${g === k ? "bg-brand-600 text-white" : "border border-line bg-white"}`}>{l}{count(k) ? ` (${count(k)})` : ""}</button>
        ))}
      </div>
      <OrderQueue group={g} />
    </>
  );
}
