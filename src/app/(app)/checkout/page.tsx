"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Banknote, CreditCard, Minus, Plus, ShoppingBag, Smartphone, Store, Trash2 } from "lucide-react";
import clsx from "clsx";
import { api, post } from "@/lib/api";
import { useCart } from "@/lib/store";
import { useMe, useOnline } from "@/lib/hooks";
import { inr } from "@/lib/pricing";
import { AddressForm } from "@/components/address-form";
import { FamilyPicker } from "@/components/customer/family-picker";
import { Badge, Button, Card, EmptyState, IconButton, LinkButton, Notice, PageTitle, SectionHeader, Select, SkeletonList, Input } from "@/components/ui";
import type { Address, Prescription } from "@/lib/types";
import type { EtaResult } from "@/lib/eta";

interface Quote {
  subtotal: number; discount: number; needsRx: boolean; offerValid: boolean;
  normal: { fee: number; total: number; eta: EtaResult };
  priority: { fee: number; total: number; eta: EtaResult } | null;
}
type Pay = "UPI" | "COD" | "CARD";
const PAYMENTS: { value: Pay; label: string; hint: string; icon: typeof Banknote }[] = [
  { value: "UPI", label: "UPI", hint: "Pay from your phone", icon: Smartphone },
  { value: "COD", label: "Cash on Delivery", hint: "Pay the delivery partner", icon: Banknote },
  { value: "CARD", label: "Card", hint: "Debit or credit card", icon: CreditCard },
];

/** A selectable row: the whole row is the tap target, with a visible "selected" mark besides colour. */
function Choice({ selected, onSelect, title, hint, right, disabled, icon: Icon }: { selected: boolean; onSelect: () => void; title: string; hint?: string; right?: string; disabled?: boolean; icon?: typeof Banknote }) {
  return (
    <button type="button" role="radio" aria-checked={selected} disabled={disabled} onClick={onSelect}
      className={clsx("flex w-full items-center gap-3 rounded-card border-2 p-3.5 text-left disabled:cursor-not-allowed disabled:opacity-50", selected ? "border-brand-600 bg-brand-50" : "border-line bg-surface hover:border-line-strong")}>
      <span aria-hidden className={clsx("grid size-6 shrink-0 place-items-center rounded-full border-2", selected ? "border-brand-600 bg-brand-600" : "border-line-strong")}>{selected && <span className="size-2 rounded-full bg-white" />}</span>
      {Icon && <Icon className="size-6 shrink-0 text-brand-700" aria-hidden />}
      <span className="min-w-0 flex-1"><span className="t-card block">{title}</span>{hint && <span className="t-caption block">{hint}</span>}</span>
      {right && <span className="t-label shrink-0">{right}</span>}
    </button>
  );
}

export default function Checkout() {
  const router = useRouter();
  const cart = useCart();
  const me = useMe();
  const online = useOnline();
  const [addressId, setAddressId] = useState("");
  const [adding, setAdding] = useState(false);
  const [member, setMember] = useState("");
  const [delivery, setDelivery] = useState<"NORMAL" | "PRIORITY">("NORMAL");
  const [payment, setPayment] = useState<Pay>("COD");
  const [offer, setOffer] = useState("");
  const [appliedOffer, setAppliedOffer] = useState<string>();

  const loggedIn = me.data?.role === "CUSTOMER";
  const addresses = useQuery({ queryKey: ["addresses"], queryFn: () => api<Address[]>("/api/addresses"), enabled: loggedIn });
  const rxs = useQuery({ queryKey: ["prescriptions"], queryFn: () => api<Omit<Prescription, "fileKey">[]>("/api/prescriptions"), enabled: loggedIn });

  useEffect(() => { if (!addressId && addresses.data?.length) setAddressId(addresses.data[0].id); }, [addresses.data, addressId]);

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
        <EmptyState icon={<ShoppingBag />} title="Your cart is empty" body="Search a medicine or upload your prescription to begin."
          action={<div className="flex flex-wrap justify-center gap-2"><LinkButton href="/medicines">Order Medicine</LinkButton><LinkButton href="/upload-prescription" variant="secondary">Upload Prescription</LinkButton></div>} />
      </>
    );
  }

  const needsRx = cart.lines.some((l) => l.prescriptionRequired);
  const subtotal = cart.lines.reduce((s, l) => s + l.price * l.quantity, 0);
  const chosen = delivery === "PRIORITY" && quote.data?.priority ? quote.data.priority : quote.data?.normal;
  const total = chosen ? chosen.total : subtotal;
  const rxUsable = rxs.data?.filter((r) => r.status !== "REJECTED") ?? [];
  const blocked = needsRx && !cart.prescriptionId;
  const canPlace = loggedIn && !!addressId && !blocked && !quote.isError && online;
  const why = !loggedIn ? "Log in to place your order." : !addressId ? "Add a delivery address to continue." : blocked ? "Add your prescription to continue." : !online ? "You are offline." : undefined;

  return (
    <>
      <PageTitle title="Checkout" back={{ href: "/medicines", label: "Add more medicines" }} />
      {!loggedIn && !me.isPending && <div className="mb-4"><Notice tone="amber" title="Log in to place your order">Your cart is saved on this phone.<div className="mt-2"><LinkButton href="/login?next=/checkout" size="sm">Log in</LinkButton></div></Notice></div>}

      <div className="grid gap-5 pb-28 lg:grid-cols-[1fr_22rem] lg:pb-0">
        <div className="space-y-5">
          <Card as="section" aria-labelledby="items" className="space-y-3">
            <div className="flex items-center gap-2"><Store className="size-5 text-brand-600" aria-hidden /><h2 id="items" className="t-section">{cart.pharmacyName}</h2></div>
            <ul className="divide-y divide-line">
              {cart.lines.map((l) => (
                <li key={l.medicineId} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div className="min-w-0 flex-1"><p className="t-card">{l.name} {l.prescriptionRequired && <Badge tone="amber">Rx</Badge>}</p><p className="t-caption">{l.strength} · {inr(l.price)} each</p></div>
                  <div className="flex items-center gap-1" role="group" aria-label={`Quantity of ${l.name}`}>
                    <IconButton label={`Decrease ${l.name}`} className="border border-line-strong" onClick={() => cart.setQty(l.medicineId, l.quantity - 1)}><Minus className="size-4" aria-hidden /></IconButton>
                    <span className="w-8 text-center font-bold" aria-live="polite">{l.quantity}</span>
                    <IconButton label={`Increase ${l.name}`} className="border border-line-strong" onClick={() => cart.setQty(l.medicineId, l.quantity + 1)}><Plus className="size-4" aria-hidden /></IconButton>
                    <IconButton label={`Remove ${l.name}`} className="text-emergency" onClick={() => cart.remove(l.medicineId)}><Trash2 className="size-5" aria-hidden /></IconButton>
                  </div>
                </li>
              ))}
            </ul>
            {needsRx && (
              <div className={clsx("rounded-control p-3", blocked ? "bg-warn-50" : "bg-surface-2")}>
                <p className="t-label mb-1">Prescription</p>
                <p className="t-caption mb-2">A pharmacist checks it before your order is confirmed. Nothing is swapped without asking you.</p>
                {rxs.isPending ? <SkeletonList rows={1} lines={1} /> : rxUsable.length === 0 ? (
                  <LinkButton href="/upload-prescription" variant="secondary" size="sm">Upload Prescription</LinkButton>
                ) : (
                  <Select label="Choose prescription" value={cart.prescriptionId ?? ""} onChange={(e) => cart.attachPrescription(e.target.value || undefined)}>
                    <option value="">Select…</option>
                    {rxUsable.map((r) => <option key={r.id} value={r.id}>{r.fileName} · {new Date(r.createdAt).toLocaleDateString("en-IN")}</option>)}
                  </Select>
                )}
                {blocked && <p role="alert" className="mt-2 text-sm font-semibold text-warn">Please add a prescription. <Link href="/upload-prescription" className="underline">Upload a new one</Link></p>}
              </div>
            )}
          </Card>

          {loggedIn && (
            <>
              <Card as="section" aria-labelledby="who"><h2 id="who" className="sr-only">Who is this order for</h2><FamilyPicker value={member} onChange={setMember} /></Card>

              <Card as="section" aria-labelledby="addr" className="space-y-3">
                <SectionHeader id="addr" title="Delivery address" />
                {addresses.isPending ? <SkeletonList rows={1} lines={2} /> : (
                  <>
                    <div role="radiogroup" aria-labelledby="addr" className="space-y-2">
                      {addresses.data?.map((a) => (
                        <Choice key={a.id} selected={addressId === a.id} onSelect={() => setAddressId(a.id)} title={`${a.label} · ${a.contactName}`}
                          hint={`${a.houseDescription}, ${a.area}, ${a.village ? `${a.village}, ` : ""}${a.town} – ${a.pincode}. Landmark: ${a.landmark}`} />
                      ))}
                    </div>
                    {adding ? <AddressForm onSaved={(a) => { setAddressId(a.id); setAdding(false); }} onCancel={() => setAdding(false)} />
                      : <Button variant="soft" onClick={() => setAdding(true)}><Plus className="size-5" aria-hidden /> Add new address</Button>}
                  </>
                )}
              </Card>

              <Card as="section" aria-labelledby="del" className="space-y-3">
                <SectionHeader id="del" title="Delivery" />
                <div role="radiogroup" aria-labelledby="del" className="space-y-2">
                  <Choice selected={delivery === "NORMAL"} onSelect={() => setDelivery("NORMAL")} title="Normal delivery"
                    hint={quote.data ? `About ${quote.data.normal.eta.range[0]}–${quote.data.normal.eta.range[1]} min` : "Pick an address to see the time"} right={quote.data ? (quote.data.normal.fee === 0 ? "Free" : inr(quote.data.normal.fee)) : undefined} />
                  <Choice selected={delivery === "PRIORITY"} onSelect={() => setDelivery("PRIORITY")} title="Priority delivery" disabled={!!quote.data && !quote.data.priority}
                    hint={quote.data ? (quote.data.priority ? `Faster packing, about ${quote.data.priority.eta.range[0]}–${quote.data.priority.eta.range[1]} min` : "Not offered by this pharmacy") : "Pick an address to see the time"} right={quote.data?.priority ? inr(quote.data.priority.fee) : undefined} />
                </div>
                {chosen && (
                  <details className="t-support"><summary className="tap cursor-pointer font-semibold text-brand-700">How is the time worked out?</summary>
                    <ul className="mt-2 space-y-0.5">{chosen.eta.breakdown.map((b) => <li key={b.label}>{b.label}: about {b.minutes} min</li>)}</ul>
                    <p className="mt-1">It is an estimate. Stock, the prescription check and delivery partner availability can change it.</p></details>
                )}
              </Card>

              <Card as="section" aria-labelledby="pay" className="space-y-3">
                <SectionHeader id="pay" title="Payment" />
                <div role="radiogroup" aria-labelledby="pay" className="space-y-2">
                  {PAYMENTS.map((p) => <Choice key={p.value} selected={payment === p.value} onSelect={() => setPayment(p.value)} title={p.label} hint={p.hint} icon={p.icon} />)}
                </div>
                <form className="flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); setAppliedOffer(offer.trim() || undefined); }}>
                  <div className="flex-1"><Input label="Offer code (optional)" value={offer} onChange={(e) => setOffer(e.target.value)} placeholder="FIRST10" /></div>
                  <Button type="submit" variant="secondary">Apply</Button>
                </form>
                {appliedOffer && quote.data && (quote.data.discount > 0 ? <p className="text-sm font-semibold text-ok">Offer applied: you save {inr(quote.data.discount)}</p> : <p className="text-sm font-semibold text-warn">This offer does not apply to this order.</p>)}
              </Card>
            </>
          )}
        </div>

        <aside className="lg:sticky lg:top-24 lg:self-start" aria-labelledby="bill">
          <Card className="space-y-3">
            <h2 id="bill" className="t-section">Bill details</h2>
            <dl className="space-y-2">
              <div className="flex justify-between gap-3"><dt>Medicines ({cart.lines.reduce((n, l) => n + l.quantity, 0)})</dt><dd className="font-semibold">{inr(subtotal)}</dd></div>
              <div className="flex justify-between gap-3"><dt>{delivery === "PRIORITY" ? "Priority delivery" : "Delivery"}</dt><dd className="font-semibold">{chosen ? (chosen.fee === 0 ? "Free" : inr(chosen.fee)) : "Shown after you pick an address"}</dd></div>
              <div className="flex justify-between gap-3"><dt>Other fees</dt><dd className="font-semibold">₹0</dd></div>
              {quote.data && quote.data.discount > 0 && <div className="flex justify-between gap-3 text-ok"><dt>Offer</dt><dd className="font-semibold">−{inr(quote.data.discount)}</dd></div>}
              <div className="flex justify-between gap-3 border-t border-line pt-3"><dt className="t-section">To pay</dt><dd className="t-number text-2xl">{inr(total)}</dd></div>
            </dl>
            <p className="t-caption">No hidden charges. What you see is what you pay{payment === "COD" ? " in cash on delivery" : ""}.</p>
            {place.isError && <Notice tone="red">{(place.error as Error).message}</Notice>}
            {quote.isError && <Notice tone="red">{(quote.error as Error).message}</Notice>}
            <div className="hidden lg:block">
              <Button size="lg" className="w-full" disabled={!canPlace} loading={place.isPending} onClick={() => place.mutate()}>{payment === "COD" ? "Place order, pay on delivery" : "Place order"}</Button>
              {why && <p className="t-caption mt-2">{why}</p>}
            </div>
            <p className="t-caption">Free cancellation before pickup. Prescription medicines are checked by a pharmacist first, and nothing is ever swapped.</p>
          </Card>
        </aside>
      </div>

      {/* Phones: the total and the main button stay in reach above the tab bar */}
      <div className="no-print fixed inset-x-0 bottom-[4.4rem] z-20 border-t border-line bg-surface p-3 shadow-[0_-4px_16px_rgb(20_35_42/0.06)] lg:hidden">
        <div className="mx-auto flex max-w-lg items-center gap-3">
          <div className="min-w-0"><p className="t-caption">To pay</p><p className="t-number text-xl leading-none">{inr(total)}</p></div>
          <Button size="lg" className="min-w-0 flex-1" disabled={!canPlace} loading={place.isPending} onClick={() => place.mutate()}>{payment === "COD" ? "Place order" : "Place order"}</Button>
        </div>
        {why && <p className="t-caption mx-auto mt-1.5 max-w-lg text-center" role="status">{why}</p>}
      </div>
    </>
  );
}
