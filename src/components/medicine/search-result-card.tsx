"use client";
import Link from "next/link";
import { ChevronRight, Clock, Store } from "lucide-react";
import { Card, StatusBadge } from "@/components/ui";
import { PrescriptionBadge } from "@/components/customer/prescription-badge";
import { trackEvent } from "@/lib/analytics-client";
import { inr } from "@/lib/pricing";
import type { SearchItem } from "@/server/features/catalog/catalog.service";

/**
 * One search result, kept short on purpose: what it is, whether it needs a prescription, the starting price, how many
 * pharmacies have it and the quickest honest delivery time. Everything else (comparing pharmacies, adding to cart) is one tap away.
 */
export function SearchResultCard({ r }: { r: SearchItem }) {
  const m = r.medicine;
  return (
    <Card as="article" className="p-0 sm:p-0">
      <Link href={`/medicines/${m.id}`} onClick={() => trackEvent("medicine_selected", { medicine: m.id, from: "result" })} className="flex items-center gap-3 p-4">
        <div className="min-w-0 flex-1 space-y-2">
          <div>
            <h3 className="t-card">{m.name}</h3>
            <p className="t-support">{m.genericName} · {m.strength}</p>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <PrescriptionBadge required={r.prescriptionRequired} restricted={false} />
            {r.availablePharmacyCount > 0
              ? <StatusBadge tone="success" icon={<Store className="size-3.5" aria-hidden />}>{r.availablePharmacyCount} {r.availablePharmacyCount === 1 ? "pharmacy has it" : "pharmacies have it"}</StatusBadge>
              : <StatusBadge tone="danger">Not available nearby</StatusBadge>}
            {r.fastestETA !== null && <StatusBadge tone="info" icon={<Clock className="size-3.5" aria-hidden />}>About {r.fastestETA} min</StatusBadge>}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <p className="t-caption">{r.startingPrice !== null ? "From" : "MRP"}</p>
          <p className="t-number text-xl leading-tight">{inr(r.startingPrice ?? m.mrp)}</p>
        </div>
        <ChevronRight className="size-5 shrink-0 text-subtle" aria-hidden />
      </Link>
    </Card>
  );
}
