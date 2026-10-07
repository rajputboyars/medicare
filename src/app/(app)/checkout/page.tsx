"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Minus, Plus, Trash2, ShoppingBag } from "lucide-react";
import { api, post } from "@/lib/api";
import { useCart } from "@/lib/store";
import { useMe } from "@/lib/hooks";
import { inr } from "@/lib/pricing";
import { AddressForm } from "@/components/address-form";
import { Badge, Button, Card, EmptyState, Input, LinkButton, Notice, PageTitle, Select, SkeletonList } from "@/components/ui";
import type { Address, FamilyMember, Prescription } from "@/lib/types";
import type { EtaResult } from "@/lib/eta";

interface Quote {
  subtotal: number; discount: number; needsRx: boolean; offerValid: boolean;
  normal: { fee: number; total: number; eta: EtaResult };
  priority: { fee: number; total: number; eta: EtaResult } | null;
}
type Pay = "UPI" | "COD" | "CARD";

export default function Checkout() {
  const router = useRouter();
  const cart = useCart();
  const me = useMe();
  const [addressId, setAddressId] = useState("");
  const [adding, setAdding] = useState(false);
  const [member, setMember] = useState("");
  const [delivery, setDelivery] = useState<"NORMAL" | "PRIORITY">("NORMAL");
  const [payment, setPayment] = useState<Pay>("UPI");
  const [offer, setOffer] = useState("");
  const [appliedOffer, setAppliedOffer] = useState<string>();

  const loggedIn = !!me.data;
  const addresses = useQuery({ queryKey: ["addresses"], queryFn: () => api<Address[]>("/api/addresses"), enabled: loggedIn });
  const family = useQuery({ queryKey: ["family"], queryFn: () => api<FamilyMember[]>("/api/family"), enabled: loggedIn });
  const rxs = useQuery({ queryKey: ["prescriptions"], queryFn: () => api<Omit<Prescription, "fileKey">[]>("/api/prescriptions"), enabled: loggedIn });

  useEffect(() => {
    if (!addressId && addresses.data?.length) setAddressId(addresses.data[0].id);
  }, [addresses.data, addressId]);

  const items = cart.lines.map((l) => ({ medicineId: l.medicineId, quantity: l.quantity }));
  const quote = useQuery({
    queryKey: ["quote", cart.pharmacyId, addressId, JSON.stringify(items), appliedOffer],
    queryFn: () => post<Quote>("/api/orders/quote", { pharmacyId: cart.pharmacyId, addressId, items, offerCode: appliedOffer }),
    enabled: loggedIn && !!cart.pharmacyId && !!addressId && items.length > 0,
    retry: false,
  });

  const place = useMutation({
    mutationFn: () => post<{ id: string }>("/api/orders", {
      pharmacyId: cart.pharmacyId, addressId, familyMemberId: member || undefined, items, prescriptionId: cart.prescriptionId,
      deliveryType: delivery, paymentMethod: payment, offerCode: appliedOffer,
    }),
    onSuccess: (o) => { cart.clear(); router.push(`/orders/${o.id}?placed=1`); },
  });

  if (cart.lines.length === 0) {
    return (
      <>
        <PageTitle title="Your cart" />
        <EmptyState icon={<ShoppingBag className="size-10" />} title="Your cart is empty" body="Search a medicine or upload your prescription to begin."
          action={<div className="flex flex-wrap justify-center gap-2"><LinkButton href="/medicines">Order Medicine</LinkButton><LinkButton href="/upload-prescription" variant="secondary">Upload Prescription</LinkButton></div>} />
      </>
    );
  }

  const needsRx = cart.lines.some((l) => l.prescriptionRequired);
  const subtotal = cart.lines.reduce((s, l) => s + l.price * l.quantity, 0);
  const chosen = delivery === "PRIORITY" && quote.data?.priority ? quote.data.priority : quote.data?.normal;
  const rxUsable = rxs.data?.filter((r) => r.status !== "REJECTED") ?? [];
  const blocked = needsRx && !cart.prescriptionId;

  return (
    <>
      <PageTitle title="Checkout" subtitle={`From ${cart.pharmacyName}`} />
      {!loggedIn && !me.isPending && (
        <div className="mb-4"><Notice tone="amber" title="Please log in to place your order"><LinkButton href="/login?next=/checkout" className="mt-2">Log in</LinkButton></Notice></div>
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-4">
          <Card as="section" aria-labelledby="items">
            <h2 id="items" className="mb-3 text-lg font-extrabold">Medicines</h2>
            <ul className="divide-y divide-line">
              {cart.lines.map((l) => (
                <li key={l.medicineId} className="flex items-center justify-between gap-3 py-3">
                  <div className="min-w-0"><p className="font-bold">{l.name}</p><p className="text-sm text-muted">{l.strength} · {inr(l.price)} each {l.prescriptionRequired && <Badge tone="amber">Rx</Badge>}</p></div>
                  <div className="flex items-center gap-1">
                    <Button variant="secondary" className="min-h-11 min-w-11 px-0" onClick={() => cart.setQty(l.medicineId, l.quantity - 1)} aria-label={`Decrease ${l.name}`}><Minus className="size-4" aria-hidden /></Button>
                    <span className="w-7 text-center font-bold">{l.quantity}</span>
                    <Button variant="secondary" className="min-h-11 min-w-11 px-0" onClick={() => cart.setQty(l.medicineId, l.quantity + 1)} aria-label={`Increase ${l.name}`}><Plus className="size-4" aria-hidden /></Button>
                    <Button variant="ghost" className="min-h-11 min-w-11 px-0 text-emergency" onClick={() => cart.remove(l.medicineId)} aria-label={`Remove ${l.name}`}><Trash2 className="size-5" aria-hidden /></Button>
                  </div>
                </li>
              ))}
            </ul>
            <Link href="/medicines" className="mt-2 inline-block font-semibold text-brand-700 underline">+ Add more medicines</Link>
          </Card>

          {needsRx && (
            <Card as="section" aria-labelledby="rx" className={blocked ? "border-amber-300" : ""}>
              <h2 id="rx" className="mb-1 text-lg font-extrabold">Prescription</h2>
              <p className="mb-3 text-sm text-muted">Needed for some medicines in your cart. A pharmacist checks it before preparing. We never substitute medicines on our own.</p>
              {rxs.isPending ? <SkeletonList rows={1} height="h-12" /> : rxUsable.length === 0 ? (
                <LinkButton href="/upload-prescription" variant="secondary">Upload Prescription</LinkButton>
              ) : (
                <Select label="Choose prescription" value={cart.prescriptionId ?? ""} onChange={(e) => cart.attachPrescription(e.target.value || undefined)}>
                  <option value="">Select…</option>
                  {rxUsable.map((r) => <option key={r.id} value={r.id}>{r.fileName} · {new Date(r.createdAt).toLocaleDateString("en-IN")} · {r.status.toLowerCase().replace("_", " ")}</option>)}
                </Select>
              )}
              {blocked && <p role="alert" className="mt-2 text-sm font-semibold text-warn">Please attach a prescription to continue. <Link href="/upload-prescription" className="underline">Upload a new one</Link></p>}
            </Card>
          )}

          {loggedIn && (
            <>
              <Card as="section" aria-labelledby="who">
                <h2 id="who" className="mb-3 text-lg font-extrabold">Who is this order for?</h2>
                <Select label="Patient" value={member} onChange={(e) => setMember(e.target.value)}>
                  <option value="">Myself</option>
                  {family.data?.filter((f) => f.relationship !== "SELF").map((f) => <option key={f.id} value={f.id}>{f.name} ({f.relationship.toLowerCase()})</option>)}
                </Select>
              </Card>

              <Card as="section" aria-labelledby="addr">
                <h2 id="addr" className="mb-3 text-lg font-extrabold">Delivery address</h2>
                {addresses.isPending ? <SkeletonList rows={1} height="h-16" /> : (
                  <>
                    <ul className="space-y-2">
                      {addresses.data?.map((a) => (
                        <li key={a.id}>
                          <label className={`flex cursor-pointer items-start gap-3 rounded-2xl border-2 p-3 ${addressId === a.id ? "border-brand-600 bg-brand-50" : "border-line"}`}>
                            <input type="radio" name="address" className="mt-1 size-5 accent-brand-600" checked={addressId === a.id} onChange={() => setAddressId(a.id)} />
                            <span><b>{a.label}</b> · {a.contactName}<br /><span className="text-sm">{a.houseDescription}, {a.area}, {a.village ? `${a.village}, ` : ""}{a.town} – {a.pincode}</span><br /><span className="text-sm text-muted">Landmark: {a.landmark}</span></span>
                          </label>
                        </li>
                      ))}
                    </ul>
                    {adding ? <div className="mt-4"><AddressForm onSaved={(a) => { setAddressId(a.id); setAdding(false); }} onCancel={() => setAdding(false)} /></div>
                      : <Button variant="soft" className="mt-3" onClick={() => setAdding(true)}>+ Add new address</Button>}
                  </>
                )}
              </Card>

              <Card as="section" aria-labelledby="del">
                <h2 id="del" className="mb-3 text-lg font-extrabold">Delivery</h2>
                <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Delivery type">
                  {([["NORMAL", "Normal delivery", quote.data?.normal], ["PRIORITY", "Priority delivery", quote.data?.priority]] as const).map(([v, label, q]) => (
                    <button key={v} type="button" role="radio" aria-checked={delivery === v} disabled={v === "PRIORITY" && quote.data && !quote.data.priority} onClick={() => setDelivery(v)}
                      className={`rounded-2xl border-2 p-3 text-left disabled:opacity-50 ${delivery === v ? "border-brand-600 bg-brand-50" : "border-line"}`}>
                      <p className="font-bold">{label}</p>
                      <p className="text-sm text-muted">{q ? `${q.fee === 0 ? "Free" : inr(q.fee)} · about ${q.eta.range[0]}–${q.eta.range[1]} min` : quote.data ? "Not offered by this pharmacy" : "Choose an address to see time"}</p>
                    </button>
                  ))}
                </div>
                {chosen && (
                  <details className="mt-3 text-sm"><summary className="cursor-pointer font-semibold text-brand-700">How is the time estimated?</summary>
                    <ul className="mt-2 space-y-0.5 text-muted">{chosen.eta.breakdown.map((b) => <li key={b.label}>{b.label}: ~{b.minutes} min</li>)}</ul>
                    <p className="mt-1 text-muted">It is an estimate. Stock, prescription check and delivery partner availability can change it.</p></details>
                )}
              </Card>

              <Card as="section" aria-labelledby="pay">
                <h2 id="pay" className="mb-3 text-lg font-extrabold">Payment</h2>
                <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Payment method">
                  {([["UPI", "UPI"], ["COD", "Cash on Delivery"], ["CARD", "Card"]] as const).map(([v, l]) => (
                    <button key={v} type="button" role="radio" aria-checked={payment === v} onClick={() => setPayment(v)}
                      className={`min-h-14 rounded-2xl border-2 px-3 font-bold ${payment === v ? "border-brand-600 bg-brand-50" : "border-line"}`}>{l}</button>
                  ))}
                </div>
                <p className="mt-2 text-sm text-muted">Wallet payments coming soon.</p>
                <form className="mt-4 flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); setAppliedOffer(offer.trim() || undefined); }}>
                  <div className="flex-1"><Input label="Offer code" value={offer} onChange={(e) => setOffer(e.target.value)} placeholder="FIRST10" /></div>
                  <Button type="submit" variant="secondary">Apply</Button>
                </form>
                {appliedOffer && quote.data && (quote.data.discount > 0 ? <p className="mt-2 text-sm font-semibold text-ok">Offer applied: −{inr(quote.data.discount)}</p> : <p className="mt-2 text-sm text-warn">This offer does not apply to this order.</p>)}
              </Card>
            </>
          )}
        </div>

        <aside className="lg:sticky lg:top-20 lg:self-start" aria-label="Order summary">
          <Card className="space-y-2">
            <h2 className="text-lg font-extrabold">Bill details</h2>
            <p className="flex justify-between"><span>Items</span><b>{inr(subtotal)}</b></p>
            <p className="flex justify-between"><span>Delivery</span><b>{chosen ? (chosen.fee === 0 ? "Free" : inr(chosen.fee)) : "—"}</b></p>
            {quote.data && quote.data.discount > 0 && <p className="flex justify-between text-ok"><span>Offer</span><b>−{inr(quote.data.discount)}</b></p>}
            <p className="flex justify-between border-t border-line pt-2 text-xl font-extrabold"><span>To pay</span><span>{chosen ? inr(chosen.total) : inr(subtotal)}</span></p>
            {place.isError && <Notice tone="red">{(place.error as Error).message}</Notice>}
            {quote.isError && <Notice tone="red">{(quote.error as Error).message}</Notice>}
            <Button className="w-full" disabled={!loggedIn || !addressId || blocked || quote.isError} loading={place.isPending} onClick={() => place.mutate()}>
              {payment === "COD" ? "Place order (pay on delivery)" : "Place order"}
            </Button>
            {!addressId && loggedIn && <p className="text-sm text-muted">Add a delivery address to continue.</p>}
            <p className="text-xs text-muted">Free cancellation before pickup. Prescription medicines are checked by a pharmacist before anything is prepared. Nothing is ever substituted.</p>
          </Card>
        </aside>
      </div>
    </>
  );
}
