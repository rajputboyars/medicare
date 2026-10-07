"use client";
import { use, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Clock, MapPin, Star, Zap } from "lucide-react";
import { api } from "@/lib/api";
import { useCart, useLocation } from "@/lib/store";
import { inr } from "@/lib/pricing";
import { Badge, Button, Card, EmptyState, LinkButton, Notice, PageTitle, QueryBoundary, SkeletonList, Verified } from "@/components/ui";
import type { Medicine } from "@/lib/types";
import type { PharmacyOffer } from "@/server/services/finder";

type Data = { medicine: Medicine; offers: PharmacyOffer[] };

export default function MedicineDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const pincode = useLocation((s) => s.pincode);
  const q = useQuery({ queryKey: ["availability", id, pincode], queryFn: () => api<Data>(`/api/medicines/${id}/availability?pincode=${pincode}`) });
  const cart = useCart();
  const [msg, setMsg] = useState<string>();

  return (
    <QueryBoundary query={q} skeleton={<SkeletonList rows={3} height="h-32" />}>
      {({ medicine: m, offers }) => {
        const closest = [...offers].sort((a, b) => a.distanceKm - b.distanceKm)[0];
        const fastest = [...offers].sort((a, b) => a.etaMinutes - b.etaMinutes)[0];
        const lowest = [...offers].sort((a, b) => a.sellingPrice - b.sellingPrice)[0];
        const add = (o: PharmacyOffer) => {
          const ok = cart.add({ id: o.pharmacyId, name: o.pharmacyName }, { medicineId: m.id, name: m.name, strength: m.strength, price: o.sellingPrice, mrp: m.mrp, prescriptionRequired: m.prescriptionRequired });
          setMsg(ok ? `Added from ${o.pharmacyName}` : `Your cart has items from ${cart.pharmacyName}. Clear your cart to order from ${o.pharmacyName}.`);
        };
        return (
          <>
            <PageTitle title={m.name} subtitle={`${m.generic} · ${m.strength} · ${m.form} · ${m.packSize}`} />
            <div className="mb-4 flex flex-wrap gap-2">
              {m.prescriptionRequired ? <Badge tone="amber">Prescription required</Badge> : <Badge>No prescription needed</Badge>}
              {m.restricted && <Badge tone="red">Restricted medicine</Badge>}
              <Badge tone="blue">Brand: {m.brand}</Badge>
            </div>
            {m.prescriptionRequired && <div className="mb-4"><Notice tone="amber" title="Pharmacist will check your prescription">We never substitute prescription medicines on our own. You will confirm the final medicines before payment.</Notice></div>}
            {msg && <div className="mb-4" role="status"><Notice tone="blue">{msg} {cart.lines.length > 0 && <a className="font-bold underline" href="/checkout">Go to cart</a>}</Notice></div>}

            {offers.length === 0 ? (
              <EmptyState title="Not available at nearby pharmacies" body="We can ask verified pharmacies around you to find it and tell you when it is available." action={<LinkButton href={`/find-medicine?q=${encodeURIComponent(m.name)}`}>Find this medicine for me</LinkButton>} />
            ) : (
              <>
                <Card className="mb-4 bg-brand-50"><p className="text-lg font-bold">Available at {offers.length} nearby {offers.length === 1 ? "pharmacy" : "pharmacies"}</p>
                  <p className="text-sm text-muted">Closest {closest.distanceKm} km · Fastest {fastest.etaMinutes} min · Lowest {inr(lowest.sellingPrice)}</p></Card>
                <ul className="space-y-3">
                  {offers.map((o) => (
                    <Card as="li" key={o.pharmacyId} className="space-y-3">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <h3 className="text-lg font-bold">{o.pharmacyName}</h3>
                          <div className="mt-1 flex flex-wrap gap-2"><Verified label="Verified Pharmacy" />
                            {o.pharmacyId === closest.pharmacyId && <Badge tone="blue">Closest</Badge>}
                            {o.pharmacyId === fastest.pharmacyId && <Badge tone="blue">Fastest</Badge>}
                            {o.pharmacyId === lowest.pharmacyId && <Badge tone="blue">Lowest price</Badge>}
                            {!o.open && <Badge tone="amber">Closed now · confirms when open</Badge>}</div>
                        </div>
                        <p className="text-xl font-extrabold">{inr(o.sellingPrice)} <span className="text-sm font-normal text-muted line-through">{inr(o.mrp)}</span></p>
                      </div>
                      <ul className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
                        <li className="flex items-center gap-1.5"><MapPin className="size-4 text-brand-600" aria-hidden /> {o.distanceKm} km</li>
                        <li className="flex items-center gap-1.5"><Clock className="size-4 text-brand-600" aria-hidden /> {o.etaMinutes}–{Math.round(o.etaMinutes * 1.4)} min</li>
                        {o.priorityAvailable && <li className="flex items-center gap-1.5"><Zap className="size-4 text-brand-600" aria-hidden /> Priority delivery</li>}
                        {o.rating > 0 && <li className="flex items-center gap-1.5"><Star className="size-4 text-amber-500" aria-hidden /> {o.rating}</li>}
                        <li className="text-muted">{o.quantity < 10 ? `Only ${o.quantity} left` : "In stock"}</li>
                      </ul>
                      <Button className="w-full sm:w-auto" onClick={() => add(o)}>Add from this pharmacy</Button>
                    </Card>
                  ))}
                </ul>
              </>
            )}
          </>
        );
      }}
    </QueryBoundary>
  );
}
