"use client";
import { useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Download, Minus, Pencil, Plus, Upload } from "lucide-react";
import clsx from "clsx";
import type { z } from "zod";
import { api, patch, post, put, upload } from "@/lib/api";
import { inventoryItemSchema } from "@/lib/validation";
import { fmtAgo, fmtDate } from "@/lib/hooks";
import { inr } from "@/lib/pricing";
import { Button, Card, EmptyState, ErrorState, IconButton, Input, Modal, Notice, PageTitle, QueryBoundary, SearchBar, Select, SkeletonList, StatusBadge, Success } from "@/components/ui";

interface Row { id: string; medicineId: string; name: string; brand: string; generic: string; strength: string; batch: string; expiry: string; mrp: number; sellingPrice: number; quantity: number; lowStockThreshold: number; low: boolean; expiringSoon: boolean; updatedAt?: string }
type Form = z.input<typeof inventoryItemSchema>;
type Filter = "all" | "low" | "out" | "expiry";

const matches: Record<Filter, (r: Row) => boolean> = { all: () => true, low: (r) => r.low && r.quantity > 0, out: (r) => r.quantity === 0, expiry: (r) => r.expiringSoon };
const FILTERS: [Filter, string][] = [["all", "All"], ["low", "Low stock"], ["out", "Out of stock"], ["expiry", "Expiring soon"]];

/** Big − / + so the stock can be fixed in a tap. Saves immediately and shows the new number straight away. */
function StockStepper({ row }: { row: Row }) {
  const qc = useQueryClient();
  const set = useMutation({
    mutationFn: (quantity: number) => patch(`/api/pharmacy/inventory/${row.id}`, { quantity }),
    onMutate: async (quantity) => {
      await qc.cancelQueries({ queryKey: ["inventory"] });
      const prev = qc.getQueryData<Row[]>(["inventory"]);
      qc.setQueryData<Row[]>(["inventory"], (rows) => rows?.map((r) => (r.id === row.id ? { ...r, quantity, low: quantity <= r.lowStockThreshold } : r)));
      return { prev };
    },
    onError: (_e, _q, ctx) => ctx?.prev && qc.setQueryData(["inventory"], ctx.prev),
    onSettled: () => { qc.invalidateQueries({ queryKey: ["inventory"] }); qc.invalidateQueries({ queryKey: ["pharmacy-dashboard"] }); },
  });
  return (
    <div className="flex items-center gap-1" role="group" aria-label={`Stock of ${row.name}`}>
      <IconButton label={`One less ${row.name}`} className="border border-line-strong bg-surface" disabled={row.quantity <= 0} onClick={() => set.mutate(row.quantity - 1)}><Minus className="size-5" aria-hidden /></IconButton>
      <output aria-live="polite" className={clsx("min-w-14 text-center text-xl font-extrabold tabular-nums", row.quantity === 0 && "text-emergency", row.low && row.quantity > 0 && "text-warn")}>{row.quantity}</output>
      <IconButton label={`One more ${row.name}`} className="border border-line-strong bg-surface" onClick={() => set.mutate(row.quantity + 1)}><Plus className="size-5" aria-hidden /></IconButton>
    </div>
  );
}

function StockForm({ row, onDone }: { row?: Row; onDone: () => void }) {
  const qc = useQueryClient();
  const meta = useQuery({ queryKey: ["catalog"], queryFn: () => api<{ catalog: { id: string; name: string; strength: string }[] }>("/api/medicines/meta"), enabled: !row });
  const { register, handleSubmit, formState: { errors } } = useForm<Form>({
    resolver: zodResolver(inventoryItemSchema),
    defaultValues: row ? { medicineId: row.medicineId, batch: row.batch, expiry: row.expiry.slice(0, 10), mrp: row.mrp, sellingPrice: row.sellingPrice, quantity: row.quantity, lowStockThreshold: row.lowStockThreshold } : { lowStockThreshold: 10 },
  });
  const save = useMutation({
    mutationFn: (v: Form) => (row ? put(`/api/pharmacy/inventory/${row.id}`, v) : post("/api/pharmacy/inventory", v)),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["inventory"] }); qc.invalidateQueries({ queryKey: ["pharmacy-dashboard"] }); onDone(); },
  });
  return (
    <form onSubmit={handleSubmit((v) => save.mutate(v))} className="grid gap-3 sm:grid-cols-2" noValidate>
      <div className="sm:col-span-2">
        {row ? <p className="t-body font-bold">{row.name} <span className="font-normal">{row.strength}</span></p>
          : <Select label="Medicine" required error={errors.medicineId?.message} {...register("medicineId")}><option value="">Choose…</option>{meta.data?.catalog.map((m) => <option key={m.id} value={m.id}>{m.name} ({m.strength})</option>)}</Select>}
      </div>
      <Input label="Quantity" required inputMode="numeric" error={errors.quantity?.message} {...register("quantity")} />
      <Input label="Selling price (₹)" required inputMode="decimal" error={errors.sellingPrice?.message} {...register("sellingPrice")} />
      <Input label="MRP (₹)" required inputMode="decimal" error={errors.mrp?.message} {...register("mrp")} />
      <Input label="Expiry date" type="date" required error={errors.expiry?.message} {...register("expiry")} />
      <Input label="Batch number" required error={errors.batch?.message} {...register("batch")} />
      <Input label="Warn me when stock is below" inputMode="numeric" error={errors.lowStockThreshold?.message} {...register("lowStockThreshold")} />
      {save.isError && <div className="sm:col-span-2"><Notice tone="red">{(save.error as Error).message}</Notice></div>}
      <div className="flex gap-2 sm:col-span-2"><Button type="submit" loading={save.isPending}>Save</Button><Button type="button" variant="secondary" onClick={onDone}>Cancel</Button></div>
    </form>
  );
}

export default function Inventory() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["inventory"], queryFn: () => api<Row[]>("/api/pharmacy/inventory") });
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Row>();
  const [text, setText] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const file = useRef<HTMLInputElement>(null);
  const bulk = useMutation({ mutationFn: (f: File) => { const fd = new FormData(); fd.set("file", f); return upload<{ imported: number; errors: { row: number; error: string }[] }>("/api/pharmacy/inventory/bulk", fd); }, onSuccess: () => qc.invalidateQueries({ queryKey: ["inventory"] }) });

  function template() {
    const csv = "medicine,batch,expiry,mrp,sellingPrice,quantity,lowStockThreshold\nParacetamol 650,B1234,2027-06-30,33,30,100,10\n";
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" })); a.download = "inventory-template.csv"; a.click();
  }

  return (
    <>
      <PageTitle title="Inventory" subtitle="Keep stock correct so customers see what you really have." action={
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => setAdding(true)}><Plus className="size-5" aria-hidden /> Add stock</Button>
          <Button variant="secondary" loading={bulk.isPending} onClick={() => file.current?.click()}><Upload className="size-5" aria-hidden /> Upload CSV</Button>
          <Button variant="ghost" onClick={template}><Download className="size-5" aria-hidden /> CSV template</Button>
          <input ref={file} type="file" accept=".csv,text/csv" className="hidden" aria-label="Upload inventory CSV" onChange={(e) => { const f = e.target.files?.[0]; if (f) bulk.mutate(f); e.target.value = ""; }} />
        </div>} />

      {bulk.isSuccess && <div className="mb-4 space-y-2"><Success title={`${bulk.data.imported} rows imported`}>{bulk.data.errors.length ? `${bulk.data.errors.length} rows had problems:` : "All rows were valid."}</Success>
        {bulk.data.errors.length > 0 && <Notice tone="amber"><ul className="list-disc pl-5">{bulk.data.errors.slice(0, 10).map((e) => <li key={e.row}>Row {e.row}: {e.error}</li>)}</ul></Notice>}</div>}
      {bulk.isError && <div className="mb-4"><ErrorState message={(bulk.error as Error).message} /></div>}

      <QueryBoundary query={q} skeleton={<SkeletonList rows={5} lines={2} />} isEmpty={(d) => d.length === 0} empty={<EmptyState title="No stock added yet" body="Add stock one by one, or upload a CSV from your billing software." action={<Button onClick={() => setAdding(true)}>Add stock</Button>} />}>
        {(rows) => {
          const needle = text.trim().toLowerCase();
          const shown = rows.filter((r) => matches[filter](r) && `${r.name} ${r.brand} ${r.generic}`.toLowerCase().includes(needle));
          return (
            <>
              <div className="sticky top-0 z-10 -mx-4 space-y-3 bg-canvas/95 px-4 pb-3 pt-1 backdrop-blur">
                <SearchBar value={text} onChange={setText} placeholder="Search medicine, brand or salt" label="Search inventory" />
                <div className="flex gap-2 overflow-x-auto" role="group" aria-label="Filter stock">
                  {FILTERS.map(([k, l]) => {
                    const n = rows.filter(matches[k]).length;
                    return <button key={k} aria-pressed={filter === k} onClick={() => setFilter(k)} className={clsx("tap shrink-0 rounded-pill px-4 font-bold", filter === k ? "bg-brand-600 text-white" : "border border-line-strong bg-surface")}>{l}{k !== "all" ? ` (${n})` : ""}</button>;
                  })}
                </div>
              </div>
              {shown.length === 0 ? <EmptyState title="Nothing matches" body="Try a different word or filter." /> : (
                <ul className="grid gap-3 lg:grid-cols-2">
                  {shown.map((r) => (
                    <Card as="li" key={r.id} className="space-y-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="t-card">{r.name} <span className="font-normal">{r.strength}</span></p>
                          <p className="t-support">{r.brand} · {r.generic}</p>
                        </div>
                        <IconButton label={`Edit ${r.name}`} className="border border-line-strong bg-surface" onClick={() => setEditing(r)}><Pencil className="size-5" aria-hidden /></IconButton>
                      </div>
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <StockStepper row={r} />
                        <div className="text-right"><p className="t-number">{inr(r.sellingPrice)}</p><p className="t-caption">MRP {inr(r.mrp)}</p></div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        {r.quantity === 0 ? <StatusBadge tone="danger" icon={<AlertTriangle className="size-3.5" aria-hidden />}>Out of stock</StatusBadge> : r.low && <StatusBadge tone="warning" icon={<AlertTriangle className="size-3.5" aria-hidden />}>Low stock</StatusBadge>}
                        {r.expiringSoon && <StatusBadge tone="warning">Expires {fmtDate(r.expiry)}</StatusBadge>}
                        <span className="t-caption">Batch {r.batch} · expiry {fmtDate(r.expiry)}{r.updatedAt ? ` · updated ${fmtAgo(r.updatedAt)}` : ""}</span>
                      </div>
                    </Card>
                  ))}
                </ul>
              )}
            </>
          );
        }}
      </QueryBoundary>

      <Modal open={adding} onClose={() => setAdding(false)} title="Add stock">{adding && <StockForm onDone={() => setAdding(false)} />}</Modal>
      <Modal open={!!editing} onClose={() => setEditing(undefined)} title="Edit stock">{editing && <StockForm key={editing.id} row={editing} onDone={() => setEditing(undefined)} />}</Modal>
      <p className="t-caption mt-4">Integration-ready: billing or POS software can call <code>/api/pharmacy/inventory/bulk</code> with the same CSV.</p>
    </>
  );
}
