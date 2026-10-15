"use client";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, PlusCircle, XCircle } from "lucide-react";
import { api, post } from "@/lib/api";
import { fmtAgo } from "@/lib/hooks";
import { Button, Card, EmptyState, Input, Modal, Notice, PageTitle, QueryBoundary, Select, SkeletonList, StatusBadge, Textarea } from "@/components/ui";
import type { ImportRow, MedicineMatchReview } from "@/lib/types";

type Item = MedicineMatchReview & { pharmacyName?: string };
interface Suggestion { medicineId: string; name: string; strength: string; generic: string }

const FORMS = ["Tablet", "Capsule", "Syrup", "Injection", "Inhaler", "Ointment", "Drops", "Device", "Sachet"];
const CATEGORIES = ["Diabetes", "Blood Pressure", "Thyroid", "Asthma", "Pain & Fever", "Antibiotic", "Mental Health", "Stomach", "Cold & Cough", "Vitamins", "Skin", "Health Essentials"];

/** Inventory lines whose medicine is not in the catalogue. Match it to an existing one, create it (duplicates are refused), or reject it. */
export default function MedicineMatches() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["admin", "matches"], queryFn: () => api<Item[]>("/api/admin/medicine-matches?status=PENDING") });
  const [target, setTarget] = useState<{ item: Item; mode: "MATCH" | "CREATE" | "REJECT" }>();
  const done = () => { setTarget(undefined); void qc.invalidateQueries({ queryKey: ["admin"] }); void qc.invalidateQueries({ queryKey: ["admin-stats"] }); };

  return (
    <>
      <PageTitle title="Medicine matches" subtitle="Pharmacies uploaded these medicines but we could not match them to the catalogue. Nothing was created automatically." />
      <QueryBoundary query={q} skeleton={<SkeletonList rows={3} lines={4} />} isEmpty={(d) => d.length === 0} empty={<EmptyState title="Nothing to review" body="When a pharmacy uploads a medicine we do not know, it appears here." />}>
        {(list) => (
          <ul className="grid gap-3 xl:grid-cols-2">
            {list.map((r) => (
              <Card as="li" key={r.id} className="space-y-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div><p className="t-card">{r.input.medicineName} <span className="font-normal">{r.input.strength}</span></p><p className="t-support">{r.pharmacyName} · line {r.line} · {fmtAgo(r.createdAt)}</p></div>
                  <StatusBadge tone="warning">Needs a decision</StatusBadge>
                </div>
                <p className="t-support">{[r.input.genericName && `Generic: ${r.input.genericName}`, r.input.manufacturer && `Maker: ${r.input.manufacturer}`, `Batch ${r.input.batch}`, `MRP ₹${r.input.mrp}`, `${r.input.stock} in stock`].filter(Boolean).join(" · ")}</p>
                {r.candidates && r.candidates.length > 0 && <p className="t-caption">Possible: {r.candidates.map((c) => `${c.name} ${c.strength}`).join(", ")}</p>}
                <div className="flex flex-wrap gap-2">
                  <Button onClick={() => setTarget({ item: r, mode: "MATCH" })}><CheckCircle2 className="size-5" aria-hidden /> Match existing</Button>
                  <Button variant="secondary" onClick={() => setTarget({ item: r, mode: "CREATE" })}><PlusCircle className="size-5" aria-hidden /> Create new</Button>
                  <Button variant="danger-outline" onClick={() => setTarget({ item: r, mode: "REJECT" })}><XCircle className="size-5" aria-hidden /> Reject</Button>
                </div>
              </Card>
            ))}
          </ul>
        )}
      </QueryBoundary>
      {target?.mode === "MATCH" && <MatchDialog item={target.item} onClose={() => setTarget(undefined)} onDone={done} />}
      {target?.mode === "CREATE" && <CreateDialog item={target.item} onClose={() => setTarget(undefined)} onDone={done} />}
      {target?.mode === "REJECT" && <RejectDialog item={target.item} onClose={() => setTarget(undefined)} onDone={done} />}
    </>
  );
}

function MatchDialog({ item, onClose, onDone }: { item: Item; onClose: () => void; onDone: () => void }) {
  const [text, setText] = useState(item.input.medicineName);
  const [pick, setPick] = useState(item.candidates?.[0]?.medicineId ?? "");
  const sug = useQuery({ queryKey: ["admin-suggest", text], enabled: text.trim().length >= 2, queryFn: () => api<Suggestion[]>(`/api/medicines/suggestions?q=${encodeURIComponent(text)}&limit=8`) });
  const save = useMutation({ mutationFn: () => post(`/api/admin/medicine-matches/${item.id}`, { action: "MATCH", medicineId: pick }), onSuccess: onDone });
  return (
    <Modal open onClose={onClose} title="Match to an existing medicine" description={`${item.input.medicineName} ${item.input.strength ?? ""}`}>
      <div className="space-y-3">
        {save.isError && <Notice tone="red">{(save.error as Error).message}</Notice>}
        <Input label="Search the catalogue" value={text} onChange={(e) => setText(e.target.value)} />
        <Select label="Medicine" value={pick} onChange={(e) => setPick(e.target.value)}>
          <option value="">Choose…</option>
          {[...(item.candidates ?? []).map((c) => ({ medicineId: c.medicineId, name: c.name, strength: c.strength, generic: "" })), ...(sug.data ?? [])].filter((v, i, a) => a.findIndex((x) => x.medicineId === v.medicineId) === i)
            .map((s) => <option key={s.medicineId} value={s.medicineId}>{s.name} · {s.strength}{s.generic ? ` · ${s.generic}` : ""}</option>)}
        </Select>
        <div className="flex gap-2"><Button loading={save.isPending} disabled={!pick} onClick={() => save.mutate()}>Match and add to stock</Button><Button variant="secondary" onClick={onClose}>Cancel</Button></div>
      </div>
    </Modal>
  );
}

function CreateDialog({ item, onClose, onDone }: { item: Item; onClose: () => void; onDone: () => void }) {
  const i: ImportRow["input"] = item.input;
  const [f, setF] = useState({ name: i.medicineName, genericName: i.genericName ?? "", brand: "", manufacturer: i.manufacturer ?? "", strength: i.strength ?? "", dosageForm: "Tablet", packSize: "", category: "Health Essentials", prescriptionRequired: false });
  const [confirmNear, setConfirmNear] = useState(false);
  const save = useMutation({
    mutationFn: () => post(`/api/admin/medicine-matches/${item.id}`, { action: "CREATE", medicine: { ...f, mrp: i.mrp }, confirmNotDuplicate: confirmNear }),
    onSuccess: onDone,
  });
  const near = save.isError && (save.error as { code?: string }).code === "POSSIBLE_DUPLICATE";
  return (
    <Modal open onClose={onClose} title="Create a new catalogue medicine" description="Check the name first: a second copy of the same product splits stock and search results.">
      <div className="space-y-3">
        {save.isError && <Notice tone={near ? "amber" : "red"}>{(save.error as Error).message}</Notice>}
        <Input label="Name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        <Input label="Generic name" value={f.genericName} onChange={(e) => setF({ ...f, genericName: e.target.value })} />
        <div className="grid grid-cols-2 gap-3">
          <Input label="Strength" value={f.strength} onChange={(e) => setF({ ...f, strength: e.target.value })} />
          <Input label="Pack size" value={f.packSize} onChange={(e) => setF({ ...f, packSize: e.target.value })} />
          <Input label="Manufacturer" value={f.manufacturer} onChange={(e) => setF({ ...f, manufacturer: e.target.value })} />
          <Input label="Brand" value={f.brand} onChange={(e) => setF({ ...f, brand: e.target.value })} />
          <Select label="Form" value={f.dosageForm} onChange={(e) => setF({ ...f, dosageForm: e.target.value })}>{FORMS.map((x) => <option key={x}>{x}</option>)}</Select>
          <Select label="Category" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>{CATEGORIES.map((x) => <option key={x}>{x}</option>)}</Select>
        </div>
        <label className="flex min-h-12 items-center gap-3 font-semibold"><input type="checkbox" className="size-6 accent-brand-600" checked={f.prescriptionRequired} onChange={(e) => setF({ ...f, prescriptionRequired: e.target.checked })} /> Needs a prescription</label>
        {near && <label className="flex min-h-12 items-start gap-3 font-semibold"><input type="checkbox" className="mt-1 size-6 accent-brand-600" checked={confirmNear} onChange={(e) => setConfirmNear(e.target.checked)} /> This is a different product from the similar ones</label>}
        <div className="flex gap-2"><Button loading={save.isPending} disabled={near && !confirmNear} onClick={() => save.mutate()}>Create and add to stock</Button><Button variant="secondary" onClick={onClose}>Cancel</Button></div>
      </div>
    </Modal>
  );
}

function RejectDialog({ item, onClose, onDone }: { item: Item; onClose: () => void; onDone: () => void }) {
  const [note, setNote] = useState("");
  const save = useMutation({ mutationFn: () => post(`/api/admin/medicine-matches/${item.id}`, { action: "REJECT", note }), onSuccess: onDone });
  return (
    <Modal open onClose={onClose} title="Reject this item" description="The pharmacy will see your reason.">
      <div className="space-y-3">
        {save.isError && <Notice tone="red">{(save.error as Error).message}</Notice>}
        <Textarea label="Reason" value={note} onChange={(e) => setNote(e.target.value)} />
        <div className="flex gap-2"><Button variant="danger" loading={save.isPending} disabled={note.trim().length < 3} onClick={() => save.mutate()}>Reject</Button><Button variant="secondary" onClick={onClose}>Cancel</Button></div>
      </div>
    </Modal>
  );
}
