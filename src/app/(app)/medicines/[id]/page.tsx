"use client";
import Link from "next/link";
import { use, useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MapPinned, SearchCheck, ShoppingBag } from "lucide-react";
import { api } from "@/lib/api";
import { trackEvent } from "@/lib/analytics-client";
import { useMe } from "@/lib/hooks";
import { useCart, useLocation } from "@/lib/store";
import { inr } from "@/lib/pricing";
import { PharmacyAvailabilityCard } from "@/components/medicine/pharmacy-availability-card";
import { SortChips, type Sort } from "@/components/medicine/sort-chips";
import { PrescriptionBadge } from "@/components/customer/prescription-badge";
import { Badge, Button, Card, ConfirmationDialog, EmptyState, LinkButton, Notice, PageTitle, QueryBoundary, SkeletonList } from "@/components/ui";
import type { AvailabilityResult, PharmacyAvailability } from "@/server/features/catalog/catalog.service";

export default function MedicineDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const pincode = useLocation((s) => s.pincode);
  const qc = useQueryClient();
  const me = useMe();
  const customer = me.data?.role === "CUSTOMER";
  const [sort, setSort] = useState<Sort>("FASTEST");
  const q = useQuery({ queryKey: ["availability", id, pincode, sort, me.data?.id], queryFn: () => api<AvailabilityResult>(`/api/medicines/${id}/availability?pincode=${pincode}&sort=${sort}`), placeholderData: (p) => p });
  const cart = useCart();
  const [added, setAdded] = useState<string>();
  const [conflict, setConflict] = useState<{ offer: PharmacyAvailability; medicine: AvailabilityResult["medicine"] }>();

  useEffect(() => { trackEvent("medicine_selected", { medicine: id, from: "detail" }); }, [id]);

  const favorite = useMutation({
    mutationFn: (v: { pharmacyId: string; on: boolean }) => api("/api/me/favorite-pharmacies", { method: "PUT", json: v }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["availability", id] }),
  });

  function add(m: AvailabilityResult["medicine"], o: PharmacyAvailability) {
    const ok = cart.add({ id: o.pharmacy.id, name: o.pharmacy.name }, { medicineId: m.id, name: m.name, strength: m.strength, price: o.sellingPrice, mrp: o.mrp, prescriptionRequired: m.prescriptionRequired });
    trackEvent("pharmacy_selected", { medicine: m.id, pharmacy: o.pharmacy.id });
    if (ok) { trackEvent("medicine_added_to_cart", { medicine: m.id }); setAdded(`Added from ${o.pharmacy.name}`); } else setConflict({ offer: o, medicine: m });
  }

  return (
    <QueryBoundary query={q} skeleton={<SkeletonList rows={3} lines={4} />}>
      {({ medicine: m, offers, covered, coverageMessage }) => {
        const nearest = [...offers].filter((o) => o.distanceKm !== null).sort((a, b) => a.distanceKm! - b.distanceKm!)[0];
        const quickest = [...offers].filter((o) => o.estimatedDelivery.minutes !== null).sort((a, b) => a.estimatedDelivery.minutes! - b.estimatedDelivery.minutes!)[0];
        const cheapest = [...offers].sort((a, b) => a.estimatedTotal - b.estimatedTotal)[0];
        const tag = (o: PharmacyAvailability) => [o === nearest ? "Nearest" : "", o === quickest ? "Fastest" : "", o === cheapest ? "Lowest total" : ""].filter(Boolean);
        return (
          <>
            <PageTitle back={{ href: "/medicines", label: "All medicines" }} title={m.name} subtitle={`${m.genericName} · ${m.strength} · ${m.dosageForm} · ${m.packSize}`} />
            <div className="mb-4 flex flex-wrap gap-1.5">
              <PrescriptionBadge required={m.prescriptionRequired} restricted={m.restricted} />
              {m.brand && <Badge tone="blue">Brand: {m.brand}</Badge>}
              {m.manufacturer && <Badge tone="gray">By {m.manufacturer}</Badge>}
            </div>
            {m.description && <p className="t-support mb-4">{m.description}</p>}
            {m.prescriptionRequired && <div className="mb-4"><Notice tone="amber" title="A pharmacist will verify your prescription">Your order is confirmed only after the pharmacist approves it. We never swap medicines on our own.</Notice></div>}

            {added && (
              <div role="status" className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-card border border-ok-line bg-ok-50 p-3">
                <p className="font-semibold">{added}</p>
                <LinkButton href="/checkout" size="sm"><ShoppingBag className="size-4" aria-hidden /> View cart ({cart.lines.reduce((n, l) => n + l.quantity, 0)})</LinkButton>
              </div>
            )}

            {!covered ? (
              <EmptyState title="We're not available in your area yet." body={coverageMessage ?? "Change your pincode to see pharmacies near you."} action={<LinkButton href="/login">Tell me when you arrive</LinkButton>} />
            ) : offers.length === 0 ? (
              <Card className="space-y-4 text-center">
                <h2 className="t-section">Out of stock nearby</h2>
                <p className="t-support">No verified pharmacy around pincode {pincode} has {m.name} right now. “Add to cart” is switched off until one does.</p>
                <Button size="lg" className="mx-auto w-full max-w-sm" disabled aria-disabled>Add to cart</Button>
                <div className="mx-auto flex max-w-sm flex-col gap-2">
                  <LinkButton href={`/medicines?q=${encodeURIComponent(m.genericName)}`} variant="secondary" size="lg"><MapPinned className="size-5" aria-hidden /> Find Nearby: same generic</LinkButton>
                  <LinkButton href={`/find-medicine?q=${encodeURIComponent(m.name)}`} size="lg" onClick={() => trackEvent("find_medicine_clicked", { medicine: m.id, from: "out_of_stock" })}><SearchCheck className="size-5" aria-hidden /> Find This Medicine For Me</LinkButton>
                </div>
              </Card>
            ) : (
              <>
                <Card className="mb-4 bg-brand-50">
                  <p className="t-section">Available at {offers.length} nearby {offers.length === 1 ? "pharmacy" : "pharmacies"}</p>
                  <p className="t-support">
                    {nearest ? `Nearest ${nearest.distanceKm} km` : "Distance unknown"} · {quickest ? `Fastest about ${quickest.estimatedDelivery.minutes} min` : "Delivery time confirmed by the pharmacy"} · Lowest total {inr(cheapest.estimatedTotal)} with delivery
                  </p>
                </Card>
                <div className="mb-3"><SortChips value={sort} onChange={setSort} label="Sort pharmacies by" /></div>
                <ul className="grid gap-3 md:grid-cols-2" aria-label="Pharmacies">
                  {offers.map((o) => (
                    <PharmacyAvailabilityCard key={o.pharmacy.id} offer={o} highlights={tag(o)} canFavorite={customer}
                      onToggleFavorite={() => favorite.mutate({ pharmacyId: o.pharmacy.id, on: !o.preferred })}
                      inCart={cart.pharmacyId === o.pharmacy.id ? cart.lines.find((l) => l.medicineId === m.id)?.quantity : undefined}
                      onAdd={() => add(m, o)} />
                  ))}
                </ul>
                <p className="t-caption mt-4">Prices and stock are set by each pharmacy. Delivery times are estimates. <Link href="/find-medicine" className="underline">Need a different strength? Ask nearby pharmacies.</Link></p>
              </>
            )}

            <ConfirmationDialog open={!!conflict} onClose={() => setConflict(undefined)} title="Start a new cart?"
              description={`Your cart has medicines from ${cart.pharmacyName}. One order can come from one pharmacy, so we would clear it to order from ${conflict?.offer.pharmacy.name}.`}
              confirmLabel="Start a new cart" cancelLabel="Keep my cart"
              onConfirm={() => { if (conflict) { cart.clear(); add(conflict.medicine, conflict.offer); } setConflict(undefined); }} />
          </>
        );
      }}
    </QueryBoundary>
  );
}
