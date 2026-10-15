"use client";
import clsx from "clsx";
import { Check, Clock, History, MapPin, PackageCheck, PackageMinus, Plus, ShieldAlert, Star, Zap } from "lucide-react";
import { Badge, Button, Card, StatusBadge, Verified } from "@/components/ui";
import { fmtAgo } from "@/lib/hooks";
import { inr } from "@/lib/pricing";
import type { PharmacyAvailability } from "@/server/features/catalog/catalog.service";

const CONFIDENCE = {
  HIGH: { tone: "success", label: "Stock updated recently" },
  MEDIUM: { tone: "info", label: "Stock may have changed" },
  LOW: { tone: "warning", label: "Stock not updated for a while" },
} as const;

/**
 * One pharmacy's offer for one medicine: who, how much, how far, how fast (or why we cannot say), how many are left and how
 * much to trust the stock figure. "Add to cart" is the only primary action.
 */
export function PharmacyAvailabilityCard({ offer, highlights = [], inCart, onAdd, onToggleFavorite, canFavorite }: {
  offer: PharmacyAvailability; highlights?: string[]; inCart?: number; onAdd: () => void; onToggleFavorite?: () => void; canFavorite?: boolean;
}) {
  const p = offer.pharmacy;
  const d = offer.estimatedDelivery;
  const low = offer.stockState === "LOW_STOCK";
  const c = CONFIDENCE[offer.inventoryConfidence];
  return (
    <Card as="li" className={clsx("space-y-3", highlights.length > 0 && "border-brand-200")}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="t-card flex items-center gap-1.5">{p.name}{offer.preferred && <Star className="size-4 fill-amber-400 text-amber-500" aria-label="Your preferred pharmacy" />}</h3>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            <Verified label="Verified pharmacy" />
            {highlights.map((h) => <Badge key={h} tone="blue">{h}</Badge>)}
            {offer.preferred && <Badge tone="amber">Your pharmacy</Badge>}
            {!p.openNow && <StatusBadge tone="warning" icon={<Clock className="size-3.5" aria-hidden />}>Closed now · opens {p.opensAt}</StatusBadge>}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <p className="t-number text-2xl leading-none">{inr(offer.sellingPrice)}</p>
          {offer.discountPercent > 0 ? <p className="t-caption mt-1"><span className="line-through">MRP {inr(offer.mrp)}</span> · save {offer.discountPercent}%</p> : <p className="t-caption mt-1">MRP {inr(offer.mrp)}</p>}
          <p className="t-caption">+ {offer.deliveryFee ? `${inr(offer.deliveryFee)} delivery` : "free delivery"}</p>
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
        <div className="flex items-center gap-1.5"><MapPin className="size-4 shrink-0 text-brand-600" aria-hidden /><dt className="sr-only">Distance</dt><dd>{offer.distanceKm !== null ? <><b>{offer.distanceKm} km</b> away</> : "Distance unknown"}</dd></div>
        <div className="flex items-center gap-1.5"><Clock className="size-4 shrink-0 text-brand-600" aria-hidden /><dt className="sr-only">Delivery time</dt>
          <dd>{d.minutes !== null && d.range ? <>About <b>{d.range[0]}–{d.range[1]} min</b></> : <span className="text-muted">{d.note ?? "Time confirmed by the pharmacy"}</span>}</dd></div>
        <div className="flex items-center gap-1.5">
          {low ? <PackageMinus className="size-4 shrink-0 text-warn" aria-hidden /> : <PackageCheck className="size-4 shrink-0 text-ok" aria-hidden />}
          <dt className="sr-only">Stock</dt><dd className={low ? "font-semibold text-warn" : ""}>{low ? `Only ${offer.availableQuantity} left` : "In stock"}</dd>
        </div>
        <div className="flex items-center gap-1.5"><History className="size-4 shrink-0 text-subtle" aria-hidden /><dt className="sr-only">Stock last updated</dt><dd className="t-caption">Updated {fmtAgo(offer.lastStockUpdateAt)}</dd></div>
        {p.priorityDelivery && <div className="col-span-2 flex items-center gap-1.5"><Zap className="size-4 shrink-0 text-brand-600" aria-hidden /><dd>Priority delivery available</dd></div>}
      </dl>
      {d.note && d.minutes !== null && <p className="t-caption">{d.note}</p>}

      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge tone={c.tone}>{c.label}</StatusBadge>
        {offer.confirmationMayBeNeeded && <p className="flex items-start gap-1.5 text-sm text-warn"><ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden /> The pharmacy may need to confirm this is in stock.</p>}
      </div>

      <div className="flex gap-2">
        <Button size="lg" className="flex-1" onClick={onAdd} variant={inCart ? "secondary" : "primary"} aria-label={`Add to cart from ${p.name}`}>
          {inCart ? <><Check className="size-5" aria-hidden /> In your cart ({inCart}). Add one more</> : <><Plus className="size-5" aria-hidden /> Add to cart</>}
        </Button>
        {canFavorite && onToggleFavorite && (
          <button type="button" onClick={onToggleFavorite} aria-pressed={offer.preferred} aria-label={offer.preferred ? `Remove ${p.name} from preferred pharmacies` : `Mark ${p.name} as preferred`}
            className="tap grid shrink-0 place-items-center rounded-control border-2 border-line-strong"><Star className={clsx("size-6", offer.preferred ? "fill-amber-400 text-amber-500" : "text-muted")} aria-hidden /></button>
        )}
      </div>
    </Card>
  );
}
