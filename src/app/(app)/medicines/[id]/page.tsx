"use client";
import Link from "next/link";
import { use, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ShoppingBag } from "lucide-react";
import { api } from "@/lib/api";
import { useCart, useLocation } from "@/lib/store";
import { inr } from "@/lib/pricing";
import { PharmacyAvailabilityCard } from "@/components/medicine/pharmacy-availability-card";
import { SortChips, type Strategy } from "@/components/medicine/sort-chips";
import { PrescriptionBadge } from "@/components/customer/prescription-badge";
import { Badge, Card, ConfirmationDialog, EmptyState, LinkButton, Notice, PageTitle, QueryBoundary, SkeletonList } from "@/components/ui";
import type { Medicine } from "@/lib/types";
import type { PharmacyOffer } from "@/server/services/finder";

type Data = { medicine: Medicine; offers: PharmacyOffer[] };

export default function MedicineDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const pincode = useLocation((s) => s.pincode);
  const q = useQuery({ queryKey: ["availability", id, pincode], queryFn: () => api<Data>(`/api/medicines/${id}/availability?pincode=${pincode}`) });
  const cart = useCart();
  const [strategy, setStrategy] = useState<Strategy>("fastest");
  const [added, setAdded] = useState<string>();
  const [conflict, setConflict] = useState<{ offer: PharmacyOffer; medicine: Medicine }>();

  function add(m: Medicine, o: PharmacyOffer) {
    const ok = cart.add({ id: o.pharmacyId, name: o.pharmacyName }, { medicineId: m.id, name: m.name, strength: m.strength, price: o.sellingPrice, mrp: m.mrp, prescriptionRequired: m.prescriptionRequired });
    if (ok) setAdded(`Added from ${o.pharmacyName}`); else setConflict({ offer: o, medicine: m });
  }

  return (
    <QueryBoundary query={q} skeleton={<SkeletonList rows={3} lines={4} />}>
      {({ medicine: m, offers }) => {
        const sorted = [...offers].sort((a, b) => strategy === "cheapest" ? a.sellingPrice - b.sellingPrice : strategy === "nearest" ? a.distanceKm - b.distanceKm : a.etaMinutes - b.etaMinutes);
        const closest = [...offers].sort((a, b) => a.distanceKm - b.distanceKm)[0];
        const fastest = [...offers].sort((a, b) => a.etaMinutes - b.etaMinutes)[0];
        const lowest = [...offers].sort((a, b) => a.sellingPrice - b.sellingPrice)[0];
        return (
          <>
            <PageTitle back={{ href: "/medicines", label: "All medicines" }} title={m.name} subtitle={`${m.generic} · ${m.strength} · ${m.form} · ${m.packSize}`} />
            <div className="mb-4 flex flex-wrap gap-1.5"><PrescriptionBadge required={m.prescriptionRequired} restricted={m.restricted} /><Badge tone="blue">Brand: {m.brand}</Badge></div>
            {m.prescriptionRequired && <div className="mb-4"><Notice tone="amber" title="A pharmacist will verify your prescription">Your order is confirmed only after the pharmacist approves it. We never swap medicines on our own.</Notice></div>}

            {added && (
              <div role="status" className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-card border border-ok-line bg-ok-50 p-3">
                <p className="font-semibold">{added}</p>
                <LinkButton href="/checkout" size="sm"><ShoppingBag className="size-4" aria-hidden /> View cart ({cart.lines.reduce((n, l) => n + l.quantity, 0)})</LinkButton>
              </div>
            )}

            {offers.length === 0 ? (
              <EmptyState title="Not available at nearby pharmacies" body="We can ask verified pharmacies around you to find it, and tell you when it is available." action={<LinkButton href={`/find-medicine?q=${encodeURIComponent(m.name)}`}>Find My Medicine</LinkButton>} />
            ) : (
              <>
                <Card className="mb-4 bg-brand-50">
                  <p className="t-section">Available at {offers.length} nearby {offers.length === 1 ? "pharmacy" : "pharmacies"}</p>
                  <p className="t-support">Closest {closest.distanceKm} km · Fastest about {fastest.etaMinutes} min · Lowest {inr(lowest.sellingPrice)}</p>
                </Card>
                <div className="mb-3"><SortChips value={strategy} onChange={setStrategy} label="Sort pharmacies by" /></div>
                <ul className="grid gap-3 md:grid-cols-2" aria-label="Pharmacies">
                  {sorted.map((o) => (
                    <PharmacyAvailabilityCard key={o.pharmacyId} offer={o}
                      highlights={[...(o.pharmacyId === closest.pharmacyId ? (["Closest"] as const) : []), ...(o.pharmacyId === fastest.pharmacyId ? (["Fastest"] as const) : []), ...(o.pharmacyId === lowest.pharmacyId ? (["Lowest price"] as const) : [])]}
                      inCart={cart.pharmacyId === o.pharmacyId ? cart.lines.find((l) => l.medicineId === m.id)?.quantity : undefined}
                      onAdd={() => add(m, o)} />
                  ))}
                </ul>
                <p className="t-caption mt-4">Prices and stock are set by each pharmacy. <Link href="/find-medicine" className="underline">Need a different strength? Ask nearby pharmacies.</Link></p>
              </>
            )}

            <ConfirmationDialog open={!!conflict} onClose={() => setConflict(undefined)} title="Start a new cart?"
              description={`Your cart has medicines from ${cart.pharmacyName}. One order can come from one pharmacy, so we would clear it to order from ${conflict?.offer.pharmacyName}.`}
              confirmLabel="Start a new cart" cancelLabel="Keep my cart"
              onConfirm={() => { if (conflict) { cart.clear(); add(conflict.medicine, conflict.offer); } setConflict(undefined); }} />
          </>
        );
      }}
    </QueryBoundary>
  );
}
