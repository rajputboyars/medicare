"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BellRing, Plus, Repeat as RepeatIcon, Trash2 } from "lucide-react";
import { api, del, post } from "@/lib/api";
import { fmtDate, useMe } from "@/lib/hooks";
import { inr } from "@/lib/pricing";
import { STATUS_LABEL, isFinal } from "@/lib/order-machine";
import { Badge, Button, Card, EmptyState, ErrorState, Input, LinkButton, Notice, PageTitle, QueryBoundary, Select, SkeletonList } from "@/components/ui";
import type { Address, FamilyMember, Order, Pharmacy, SavedMedicine } from "@/lib/types";

type R = SavedMedicine & { daysLeft: number; forName?: string; meds: { medicineId: string; name: string; quantity: number; prescriptionRequired: boolean }[] };
const LABELS = ["Diabetes", "Blood pressure", "Thyroid", "Asthma", "Other chronic medication"];

export default function Repeat() {
  const me = useMe();
  const qc = useQueryClient();
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [label, setLabel] = useState(LABELS[0]);
  const [forMember, setForMember] = useState("");
  const [picked, setPicked] = useState<Record<string, number>>({});
  const [pharmacyId, setPharmacyId] = useState("");
  const [days, setDays] = useState("30");
  const [formErr, setFormErr] = useState<string>();

  const enabled = me.data?.role === "CUSTOMER";
  const saved = useQuery({ queryKey: ["saved"], queryFn: () => api<R[]>("/api/saved"), enabled });
  const orders = useQuery({ queryKey: ["orders"], queryFn: () => api<Order[]>("/api/orders"), enabled });
  const addresses = useQuery({ queryKey: ["addresses"], queryFn: () => api<Address[]>("/api/addresses"), enabled });
  const family = useQuery({ queryKey: ["family"], queryFn: () => api<FamilyMember[]>("/api/family"), enabled });
  const catalog = useQuery({ queryKey: ["catalog"], queryFn: () => api<{ catalog: { id: string; name: string; strength: string }[] }>("/api/medicines/meta"), enabled: adding });
  const pharmacies = useQuery({ queryKey: ["pharmacies", "261001"], queryFn: () => api<Pharmacy[]>("/api/pharmacies/nearby?pincode=261001"), enabled: adding });
  const refresh = () => qc.invalidateQueries({ queryKey: ["saved"] });

  const save = useMutation({
    mutationFn: () => post("/api/saved", { label, familyMemberId: forMember || undefined, items: Object.entries(picked).map(([medicineId, quantity]) => ({ medicineId, quantity })), everyDays: Number(days), preferredPharmacyId: pharmacyId || undefined }),
    onSuccess: () => { refresh(); setAdding(false); setPicked({}); },
  });
  const toggle = useMutation({ mutationFn: (v: { id: string; on: boolean }) => post(`/api/saved/${v.id}`, { action: "reminder", on: v.on }), onSuccess: refresh });
  const remove = useMutation({ mutationFn: (id: string) => del(`/api/saved/${id}`), onSuccess: refresh });
  const reorderSaved = useMutation({
    mutationFn: (id: string) => post<{ id: string }>(`/api/saved/${id}`, { action: "reorder", addressId: addresses.data![0].id, paymentMethod: "COD" }),
    onSuccess: (o) => router.push(`/orders/${o.id}?placed=1`),
  });
  const repeat = useMutation({ mutationFn: (id: string) => post<{ id: string }>(`/api/orders/${id}`, { action: "repeat" }), onSuccess: (o) => router.push(`/orders/${o.id}?placed=1`) });

  if (me.isPending) return <SkeletonList />;
  if (!enabled) return (<><PageTitle title="Repeat Order" /><EmptyState title="Log in to repeat orders and save medicines" action={<LinkButton href="/login?next=/repeat">Log in</LinkButton>} /></>);
  const error = (reorderSaved.error ?? repeat.error) as Error | null;

  return (
    <>
      <PageTitle title="Repeat Order" subtitle="Reorder in one tap, or keep your monthly medicines saved with a refill reminder." />
      <div className="mb-4"><Notice tone="blue">Prescription medicines are never bought automatically. Every reorder goes to the pharmacist for checking first.</Notice></div>
      {error && <div className="mb-4"><ErrorState message={error.message} /></div>}

      <section aria-labelledby="prev" className="mb-8">
        <h2 id="prev" className="mb-3 text-xl font-extrabold">Previous orders</h2>
        <QueryBoundary query={orders} skeleton={<SkeletonList rows={2} height="h-28" />} isEmpty={(d) => d.filter((o) => isFinal(o.status)).length === 0} empty={<EmptyState title="No previous orders yet" body="Once an order is delivered you can repeat it here." action={<LinkButton href="/medicines">Order Medicine</LinkButton>} />}>
          {(list) => (
            <ul className="space-y-3">
              {list.filter((o) => isFinal(o.status)).slice(0, 6).map((o) => (
                <Card as="li" key={o.id} className="space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2"><p className="font-bold">{o.code} · {inr(o.total)}</p><Badge tone={o.status === "DELIVERED" ? "green" : "red"}>{STATUS_LABEL[o.status]}</Badge></div>
                  <p className="text-sm text-muted">{o.items.map((i) => `${i.name} ×${i.quantity}`).join(", ")}</p>
                  <Button loading={repeat.isPending && repeat.variables === o.id} onClick={() => repeat.mutate(o.id)}><RepeatIcon className="size-5" aria-hidden /> Reorder in one tap</Button>
                </Card>
              ))}
            </ul>
          )}
        </QueryBoundary>
      </section>

      <section aria-labelledby="sv">
        <div className="mb-3 flex items-center justify-between gap-3"><h2 id="sv" className="text-xl font-extrabold">Saved medicines</h2>
          <Button variant="secondary" onClick={() => setAdding((a) => !a)}><Plus className="size-5" aria-hidden /> New list</Button></div>

        {adding && (
          <Card className="mb-4 space-y-4">
            {formErr && <Notice tone="red">{formErr}</Notice>}
            <Select label="For" value={forMember} onChange={(e) => setForMember(e.target.value)}><option value="">Myself</option>{family.data?.filter((f) => f.relationship !== "SELF").map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</Select>
            <Select label="What is it for?" value={label} onChange={(e) => setLabel(e.target.value)}>{LABELS.map((c) => <option key={c}>{c}</option>)}</Select>
            <fieldset><legend className="mb-2 text-sm font-semibold">Medicines</legend>
              {catalog.isPending ? <SkeletonList rows={2} height="h-10" /> : (
                <ul className="max-h-64 space-y-1 overflow-y-auto rounded-2xl border border-line p-2">
                  {catalog.data?.catalog.map((m) => (
                    <li key={m.id} className="flex items-center justify-between gap-2">
                      <label className="flex min-h-11 flex-1 items-center gap-3"><input type="checkbox" className="size-5 accent-brand-600" checked={m.id in picked} onChange={(e) => setPicked((p) => { const n = { ...p }; if (e.target.checked) n[m.id] = 1; else delete n[m.id]; return n; })} /> {m.name} <span className="text-sm text-muted">{m.strength}</span></label>
                      {m.id in picked && <input aria-label={`Quantity of ${m.name}`} type="number" min={1} max={12} className="h-11 w-16 rounded-xl border-2 border-line text-center" value={picked[m.id]} onChange={(e) => setPicked((p) => ({ ...p, [m.id]: Math.max(1, Math.min(12, Number(e.target.value) || 1)) }))} />}
                    </li>
                  ))}
                </ul>
              )}
            </fieldset>
            <div className="grid gap-4 sm:grid-cols-2">
              <Input label="Remind me every (days)" type="number" min={7} max={90} value={days} onChange={(e) => setDays(e.target.value)} />
              <Select label="Preferred pharmacy" value={pharmacyId} onChange={(e) => setPharmacyId(e.target.value)}><option value="">Any nearby pharmacy</option>{pharmacies.data?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select>
            </div>
            {save.isError && <Notice tone="red">{(save.error as Error).message}</Notice>}
            <div className="flex gap-2"><Button loading={save.isPending} onClick={() => (Object.keys(picked).length ? (setFormErr(undefined), save.mutate()) : setFormErr("Choose at least one medicine"))}>Save</Button><Button variant="ghost" onClick={() => setAdding(false)}>Cancel</Button></div>
          </Card>
        )}

        <QueryBoundary query={saved} skeleton={<SkeletonList rows={2} height="h-36" />} isEmpty={(d) => d.length === 0} empty={<EmptyState title="No saved medicines yet" body="Save medicines for diabetes, BP, thyroid, asthma and more. We remind you before they run out." />}>
          {(rows) => (
            <ul className="space-y-3">
              {rows.map((r) => (
                <Card as="li" key={r.id} className="space-y-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div><h3 className="text-lg font-bold">{r.label}</h3><p className="text-sm text-muted">{r.forName ? `For ${r.forName} · ` : ""}every {r.everyDays} days · next refill {fmtDate(r.nextRefillAt)}</p></div>
                    <Badge tone={r.daysLeft <= 0 ? "red" : r.daysLeft <= 7 ? "amber" : "green"}>{r.daysLeft <= 0 ? "Refill due now" : `Due in ${r.daysLeft} days`}</Badge>
                  </div>
                  <ul className="text-sm">{r.meds.map((m) => <li key={m.medicineId}>• {m.name} ×{m.quantity} {m.prescriptionRequired && <Badge tone="amber">Rx</Badge>}</li>)}</ul>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button loading={reorderSaved.isPending && reorderSaved.variables === r.id} disabled={!addresses.data?.length} onClick={() => reorderSaved.mutate(r.id)}>Reorder now</Button>
                    <label className="flex min-h-12 items-center gap-2 rounded-2xl px-3 font-semibold"><input type="checkbox" className="size-6 accent-brand-600" checked={r.reminderOn} onChange={(e) => toggle.mutate({ id: r.id, on: e.target.checked })} /><BellRing className="size-5" aria-hidden /> Remind me</label>
                    <Button variant="ghost" className="text-emergency" onClick={() => remove.mutate(r.id)} aria-label={`Delete ${r.label}`}><Trash2 className="size-5" aria-hidden /></Button>
                  </div>
                  {!addresses.isPending && !addresses.data?.length && <p className="text-sm text-warn">Add a delivery address in Profile first.</p>}
                </Card>
              ))}
            </ul>
          )}
        </QueryBoundary>
      </section>
    </>
  );
}
