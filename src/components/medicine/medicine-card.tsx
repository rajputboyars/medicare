"use client";
import Link from "next/link";
import { useState } from "react";
import { Clock, MapPin, Plus, Minus, Search, Store, Tag } from "lucide-react";
import { Badge, Button, Card } from "@/components/ui";
import { useCart } from "@/lib/store";
import { inr } from "@/lib/pricing";
import type { MedicineResult, PharmacyOffer } from "@/server/services/finder";

export type Strategy = "fastest" | "cheapest" | "nearest" | "preferred";

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

export function MedicineCard({ r, strategy, preferredId }: { r: MedicineResult; strategy: Strategy; preferredId?: string }) {
  const m = r.medicine;
  const cart = useCart();
  const [conflict, setConflict] = useState<PharmacyOffer>();

  // Keep the whole cart with one pharmacy: prefer it if it stocks this medicine.
  const cartOffer = cart.pharmacyId && cart.lines.length ? r.offers.find((o) => o.pharmacyId === cart.pharmacyId) : undefined;
  const offer = cartOffer ?? pickOffer(r.offers, strategy, preferredId);
  const line = cart.lines.find((l) => l.medicineId === m.id);

  function add(o: PharmacyOffer) {
    const ok = cart.add({ id: o.pharmacyId, name: o.pharmacyName }, { medicineId: m.id, name: m.name, strength: m.strength, price: o.sellingPrice, mrp: m.mrp, prescriptionRequired: m.prescriptionRequired });
    setConflict(ok ? undefined : o);
  }

  return (
    <Card as="article" className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-lg font-bold leading-snug"><Link href={`/medicines/${m.id}`} className="hover:underline">{m.name}</Link></h3>
          <p className="text-sm text-muted">{m.generic} · {m.strength} · {m.form} · {m.packSize}</p>
          <p className="text-sm text-muted">Brand: {m.brand}</p>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-xl font-extrabold">{inr(offer?.sellingPrice ?? m.mrp)}</p>
          <p className="text-sm text-muted">MRP <span className="line-through">{inr(m.mrp)}</span></p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {m.prescriptionRequired ? <Badge tone="amber">Prescription required</Badge> : <Badge tone="gray">No prescription needed</Badge>}
        {m.restricted && <Badge tone="red">Restricted · approved prescription only</Badge>}
        {r.available ? <Badge tone="green">Available at {r.pharmacyCount} nearby {r.pharmacyCount === 1 ? "pharmacy" : "pharmacies"}</Badge> : <Badge tone="red">Not available nearby</Badge>}
      </div>

      {r.available && offer ? (
        <>
          <ul className="grid gap-1 text-sm sm:grid-cols-3">
            <li className="flex items-center gap-1.5"><MapPin className="size-4 text-brand-600" aria-hidden /> Closest: <b>{r.closest!.km} km</b></li>
            <li className="flex items-center gap-1.5"><Clock className="size-4 text-brand-600" aria-hidden /> Fastest: <b>{r.fastest!.minutes} min</b></li>
            <li className="flex items-center gap-1.5"><Tag className="size-4 text-brand-600" aria-hidden /> Lowest: <b>{inr(r.lowest!.price)}</b></li>
          </ul>
          <p className="flex items-center gap-1.5 text-sm text-muted"><Store className="size-4" aria-hidden /> From <b className="text-ink">{offer.pharmacyName}</b> · {offer.distanceKm} km · about {offer.etaMinutes}–{Math.round(offer.etaMinutes * 1.4)} min</p>
          <div className="flex items-center justify-between gap-3">
            <Link href={`/medicines/${m.id}`} className="text-sm font-semibold text-brand-700 underline">Compare pharmacies</Link>
            {line && cart.pharmacyId === offer.pharmacyId ? (
              <div className="flex items-center gap-2" role="group" aria-label={`Quantity of ${m.name}`}>
                <Button variant="secondary" className="min-h-12 min-w-12 px-0" onClick={() => cart.setQty(m.id, line.quantity - 1)} aria-label="Decrease quantity"><Minus className="size-5" aria-hidden /></Button>
                <span className="w-8 text-center text-lg font-bold" aria-live="polite">{line.quantity}</span>
                <Button variant="secondary" className="min-h-12 min-w-12 px-0" onClick={() => cart.setQty(m.id, line.quantity + 1)} disabled={line.quantity >= Math.min(20, offer.quantity)} aria-label="Increase quantity"><Plus className="size-5" aria-hidden /></Button>
              </div>
            ) : (
              <Button onClick={() => add(offer)} aria-label={`Add ${m.name} to cart`}><Plus className="size-5" aria-hidden /> Add</Button>
            )}
          </div>
          {conflict && (
            <div role="alert" className="rounded-2xl border-2 border-amber-300 bg-warn-50 p-3 text-sm">
              Your cart has medicines from <b>{cart.pharmacyName}</b>, which does not stock this. One order can come from one pharmacy.
              <div className="mt-2 flex flex-wrap gap-2">
                <Button variant="secondary" className="min-h-10 py-2" onClick={() => { cart.clear(); add(conflict); }}>Start a new cart</Button>
                <Button variant="ghost" className="min-h-10 py-2" onClick={() => setConflict(undefined)}>Keep my cart</Button>
              </div>
            </div>
          )}
        </>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-stone-50 p-3">
          <p className="text-sm text-muted">No verified pharmacy near you has this right now.</p>
          <Link href={`/find-medicine?q=${encodeURIComponent(m.name)}`} className="inline-flex min-h-12 items-center gap-2 rounded-2xl bg-brand-600 px-4 font-semibold text-white"><Search className="size-5" aria-hidden /> Find this medicine for me</Link>
        </div>
      )}
    </Card>
  );
}
