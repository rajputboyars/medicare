"use client";
import Link from "next/link";
import { useState } from "react";
import { Clock, MapPin, Minus, Plus, SearchCheck, Store } from "lucide-react";
import { Button, Card, ConfirmationDialog, StatusBadge } from "@/components/ui";
import { PrescriptionBadge } from "@/components/customer/prescription-badge";
import { useCart } from "@/lib/store";
import { inr } from "@/lib/pricing";
import type { MedicineResult, PharmacyOffer } from "@/server/features/medicines/finder.service";
import type { Strategy } from "./sort-chips";

export type { Strategy } from "./sort-chips";

export function pickOffer(offers: PharmacyOffer[], strategy: Strategy, preferredId?: string): PharmacyOffer | undefined {
  if (!offers.length) return undefined;
  if (strategy === "preferred" && preferredId) {
    const p = offers.find((o) => o.pharmacyId === preferredId);
    if (p) return p;
  }
  const sorted = [...offers].sort((a, b) =>
    strategy === "cheapest" ? a.sellingPrice - b.sellingPrice : strategy === "nearest" ? a.distanceKm - b.distanceKm : a.etaMinutes - b.etaMinutes,
  );
  return sorted[0];
}

/**
 * Search result: name, generic, strength, prescription badge, starting price, nearby availability and the fastest time.
 * "Add" uses the best pharmacy for the chosen sort. One order comes from one pharmacy, so mixing asks first.
 */
export function MedicineCard({ r, strategy, preferredId }: { r: MedicineResult; strategy: Strategy; preferredId?: string }) {
  const m = r.medicine;
  const cart = useCart();
  const [conflict, setConflict] = useState<PharmacyOffer>();

  const cartOffer = cart.pharmacyId && cart.lines.length ? r.offers.find((o) => o.pharmacyId === cart.pharmacyId) : undefined;
  const offer = cartOffer ?? pickOffer(r.offers, strategy, preferredId);
  const line = cart.lines.find((l) => l.medicineId === m.id);
  const startingPrice = r.lowest?.price ?? m.mrp;

  function add(o: PharmacyOffer) {
    const ok = cart.add({ id: o.pharmacyId, name: o.pharmacyName }, { medicineId: m.id, name: m.name, strength: m.strength, price: o.sellingPrice, mrp: m.mrp, prescriptionRequired: m.prescriptionRequired });
    setConflict(ok ? undefined : o);
  }

  return (
    <Card as="article" className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="t-card"><Link href={`/medicines/${m.id}`} className="hover:underline">{m.name}</Link></h3>
          <p className="t-support">{m.genericName} · {m.strength} · {m.dosageForm}</p>
        </div>
        <div className="shrink-0 text-right">
          <p className="t-caption">{r.available ? "Starting at" : "MRP"}</p>
          <p className="t-number text-xl leading-tight">{inr(startingPrice)}</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5">
        <PrescriptionBadge required={m.prescriptionRequired} restricted={m.restricted} />
        {r.available
          ? <StatusBadge tone="success" icon={<Store className="size-3.5" aria-hidden />}>Available at {r.pharmacyCount} nearby {r.pharmacyCount === 1 ? "pharmacy" : "pharmacies"}</StatusBadge>
          : <StatusBadge tone="danger">Not available nearby</StatusBadge>}
      </div>

      {r.available && offer ? (
        <>
          <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
            <span className="flex items-center gap-1.5"><Clock className="size-4 text-brand-600" aria-hidden /> Fastest about <b>{r.fastest!.minutes} min</b></span>
            <span className="flex items-center gap-1.5"><MapPin className="size-4 text-brand-600" aria-hidden /> Nearest <b>{r.closest!.km} km</b></span>
          </p>
          <p className="t-caption">From <b className="text-ink">{offer.pharmacyName}</b> · {inr(offer.sellingPrice)}</p>
          <div className="flex items-center justify-between gap-3">
            <Link href={`/medicines/${m.id}`} className="tap inline-flex items-center text-sm font-bold text-brand-700 underline">Compare pharmacies</Link>
            {line && cart.pharmacyId === offer.pharmacyId ? (
              <div className="flex items-center gap-1.5" role="group" aria-label={`Quantity of ${m.name}`}>
                <Button variant="secondary" className="!px-0 w-12" onClick={() => cart.setQty(m.id, line.quantity - 1)} aria-label="Decrease quantity"><Minus className="size-5" aria-hidden /></Button>
                <span className="w-8 text-center text-lg font-bold" aria-live="polite">{line.quantity}</span>
                <Button variant="secondary" className="!px-0 w-12" onClick={() => cart.setQty(m.id, line.quantity + 1)} disabled={line.quantity >= Math.min(20, offer.quantity)} aria-label="Increase quantity"><Plus className="size-5" aria-hidden /></Button>
              </div>
            ) : (
              <Button onClick={() => add(offer)} aria-label={`Add ${m.name} to cart`}><Plus className="size-5" aria-hidden /> Add</Button>
            )}
          </div>
        </>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-control bg-surface-2 p-3">
          <p className="t-support">No verified pharmacy near you has this right now.</p>
          <Link href={`/find-medicine?q=${encodeURIComponent(m.name)}`} className="tap inline-flex items-center gap-2 rounded-control bg-brand-600 px-4 font-semibold text-white"><SearchCheck className="size-5" aria-hidden /> Find My Medicine</Link>
        </div>
      )}

      <ConfirmationDialog
        open={!!conflict}
        onClose={() => setConflict(undefined)}
        onConfirm={() => { if (conflict) { cart.clear(); add(conflict); } setConflict(undefined); }}
        title="Start a new cart?"
        description={`Your cart has medicines from ${cart.pharmacyName}, which does not stock this. One order can come from one pharmacy.`}
        confirmLabel="Start a new cart"
        cancelLabel="Keep my cart"
      />
    </Card>
  );
}
