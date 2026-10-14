"use client";
import clsx from "clsx";
import { Check, Clock, History, MapPin, PackageCheck, PackageMinus, Plus, Zap } from "lucide-react";
import { Badge, Button, Card, StatusBadge, Verified } from "@/components/ui";
import { fmtAgo } from "@/lib/hooks";
import { inr } from "@/lib/pricing";
import type { PharmacyOffer } from "@/server/features/medicines/finder.service";

/**
 * One pharmacy's offer for one medicine: who, how much, how far, how fast, how many are left, and how fresh the stock info is.
 * The "Add to cart" button is the only primary action.
 */
export function PharmacyAvailabilityCard({ offer, highlights = [], inCart, onAdd }: {
  offer: PharmacyOffer; highlights?: ("Closest" | "Fastest" | "Lowest price")[]; inCart?: number; onAdd: () => void;
}) {
  const saving = offer.mrp > offer.sellingPrice ? Math.round(((offer.mrp - offer.sellingPrice) / offer.mrp) * 100) : 0;
  const low = offer.quantity < 10;
  return (
    <Card as="li" className={clsx("space-y-3", highlights.length > 0 && "border-brand-200")}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="t-card">{offer.pharmacyName}</h3>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            <Verified label="Verified pharmacy" />
            {highlights.map((h) => <Badge key={h} tone="blue">{h}</Badge>)}
            {!offer.open && <StatusBadge tone="warning" icon={<Clock className="size-3.5" aria-hidden />}>Closed now, confirms when open</StatusBadge>}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <p className="t-number text-2xl leading-none">{inr(offer.sellingPrice)}</p>
          {saving > 0 && <p className="t-caption mt-1"><span className="line-through">{inr(offer.mrp)}</span> · save {saving}%</p>}
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
        <div className="flex items-center gap-1.5"><MapPin className="size-4 shrink-0 text-brand-600" aria-hidden /><dt className="sr-only">Distance</dt><dd><b>{offer.distanceKm} km</b> away</dd></div>
        <div className="flex items-center gap-1.5"><Clock className="size-4 shrink-0 text-brand-600" aria-hidden /><dt className="sr-only">Delivery time</dt><dd>About <b>{offer.etaMinutes}–{Math.round(offer.etaMinutes * 1.4)} min</b></dd></div>
        <div className="flex items-center gap-1.5">
          {low ? <PackageMinus className="size-4 shrink-0 text-warn" aria-hidden /> : <PackageCheck className="size-4 shrink-0 text-ok" aria-hidden />}
          <dt className="sr-only">Stock</dt><dd className={low ? "font-semibold text-warn" : ""}>{low ? `Only ${offer.quantity} left` : "In stock"}</dd>
        </div>
        <div className="flex items-center gap-1.5"><History className="size-4 shrink-0 text-subtle" aria-hidden /><dt className="sr-only">Stock last updated</dt><dd className="t-caption">Stock checked {fmtAgo(offer.updatedAt)}</dd></div>
        {offer.priorityAvailable && <div className="col-span-2 flex items-center gap-1.5"><Zap className="size-4 shrink-0 text-brand-600" aria-hidden /><dd>Priority delivery available</dd></div>}
      </dl>

      <Button size="lg" className="w-full" onClick={onAdd} variant={inCart ? "secondary" : "primary"} aria-label={`Add to cart from ${offer.pharmacyName}`}>
        {inCart ? <><Check className="size-5" aria-hidden /> In your cart ({inCart}). Add one more</> : <><Plus className="size-5" aria-hidden /> Add to cart</>}
      </Button>
    </Card>
  );
}
