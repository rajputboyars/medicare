"use client";
import { useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Download, Plus, Upload } from "lucide-react";
import type { z } from "zod";
import { api, patch, post, upload } from "@/lib/api";
import { inventoryItemSchema } from "@/lib/validation";
import { fmtDate } from "@/lib/hooks";
import { inr } from "@/lib/pricing";
import { Badge, Button, Card, EmptyState, ErrorState, Input, Notice, PageTitle, QueryBoundary, Select, SkeletonList, Success } from "@/components/ui";

interface Row { id: string; medicineId: string; name: string; brand: string; generic: string; strength: string; batch: string; expiry: string; mrp: number; sellingPrice: number; quantity: number; low: boolean; expiringSoon: boolean }
type Form = z.input<typeof inventoryItemSchema>;

function QtyCell({ row }: { row: Row }) {
  const qc = useQueryClient();
  const [v, setV] = useState(String(row.quantity));
  const save = useMutation({ mutationFn: () => patch(`/api/pharmacy/inventory/${row.id}`, { quantity: Number(v) }), onSuccess: () => qc.invalidateQueries({ queryKey: ["inventory"] }) });
  const dirty = Number(v) !== row.quantity;
  return (
    <div className="flex items-center gap-1">
      <input aria-label={`Quantity of ${row.name}`} inputMode="numeric" value={v} onChange={(e) => setV(e.target.value.replace(/\D/g, ""))} className={`h-11 w-20 rounded-xl border-2 text-center ${row.low ? "border-amber-400" : "border-line"}`} />
      {dirty && <Button className="min-h-11 px-3 py-1" loading={save.isPending} onClick={() => save.mutate()}>Save</Button>}
    </div>
  );
}

export default function Inventory() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["inventory"], queryFn: () => api<Row[]>("/api/pharmacy/inventory") });
  const meta = useQuery({ queryKey: ["catalog"], queryFn: () => api<{ catalog: { id: string; name: string; strength: string; mrp: number }[] }>("/api/medicines/meta") });
  const [adding, setAdding] = useState(false);
  const [filter, setFilter] = useState("");
  const [lowOnly, setLowOnly] = useState(false);
  const file = useRef<HTMLInputElement>(null);

  const { register, handleSubmit, reset, formState: { errors } } = useForm<Form>({ resolver: zodResolver(inventoryItemSchema), defaultValues: { lowStockThreshold: 10 } });
  const add = useMutation({ mutationFn: (v: Form) => post("/api/pharmacy/inventory", v), onSuccess: () => { qc.invalidateQueries({ queryKey: ["inventory"] }); reset(); setAdding(false); } });
  const bulk = useMutation({ mutationFn: (f: File) => { const fd = new FormData(); fd.set("file", f); return upload<{ imported: number; errors: { row: number; error: string }[] }>("/api/pharmacy/inventory/bulk", fd); }, onSuccess: () => qc.invalidateQueries({ queryKey: ["inventory"] }) });

  function template() {
    const csv = "medicine,batch,expiry,mrp,sellingPrice,quantity,lowStockThreshold\nParacetamol 650,B1234,2027-06-30,33,30,100,10\n";
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" })); a.download = "inventory-template.csv"; a.click();
  }

  return (
    <>
      <PageTitle title="Inventory" subtitle="Keep stock accurate so customers see what you really have." action={
        <div className="flex flex-wrap gap-2"><Button variant="secondary" onClick={template}><Download className="size-5" aria-hidden /> CSV template</Button>
          <Button variant="secondary" loading={bulk.isPending} onClick={() => file.current?.click()}><Upload className="size-5" aria-hidden /> Upload CSV</Button>
          <Button onClick={() => setAdding((a) => !a)}><Plus className="size-5" aria-hidden /> Add stock</Button>
          <input ref={file} type="file" accept=".csv,text/csv" className="hidden" aria-label="Upload inventory CSV" onChange={(e) => { const f = e.target.files?.[0]; if (f) bulk.mutate(f); e.target.value = ""; }} /></div>} />

      {bulk.isSuccess && <div className="mb-4 space-y-2"><Success title={`${bulk.data.imported} rows imported`}>{bulk.data.errors.length ? `${bulk.data.errors.length} rows had problems:` : "All rows were valid."}</Success>
        {bulk.data.errors.length > 0 && <Notice tone="amber"><ul className="list-disc pl-5">{bulk.data.errors.slice(0, 10).map((e) => <li key={e.row}>Row {e.row}: {e.error}</li>)}</ul></Notice>}</div>}
      {bulk.isError && <div className="mb-4"><ErrorState message={(bulk.error as Error).message} /></div>}

      {adding && (
        <Card className="mb-4">
          <form onSubmit={handleSubmit((v) => add.mutate(v))} className="grid gap-4 sm:grid-cols-2" noValidate>
            <div className="sm:col-span-2"><Select label="Medicine" required error={errors.medicineId?.message} {...register("medicineId")}><option value="">Choose…</option>{meta.data?.catalog.map((m) => <option key={m.id} value={m.id}>{m.name} ({m.strength})</option>)}</Select></div>
            <Input label="Batch" required error={errors.batch?.message} {...register("batch")} />
            <Input label="Expiry" type="date" required error={errors.expiry?.message} {...register("expiry")} />
            <Input label="MRP (₹)" inputMode="decimal" required error={errors.mrp?.message} {...register("mrp")} />
            <Input label="Selling price (₹)" inputMode="decimal" required error={errors.sellingPrice?.message} {...register("sellingPrice")} />
            <Input label="Quantity" inputMode="numeric" required error={errors.quantity?.message} {...register("quantity")} />
            <Input label="Low-stock alert at" inputMode="numeric" error={errors.lowStockThreshold?.message} {...register("lowStockThreshold")} />
            {add.isError && <div className="sm:col-span-2"><Notice tone="red">{(add.error as Error).message}</Notice></div>}
            <div className="flex gap-2 sm:col-span-2"><Button type="submit" loading={add.isPending}>Save stock</Button><Button type="button" variant="ghost" onClick={() => setAdding(false)}>Cancel</Button></div>
          </form>
        </Card>
      )}

      <div className="mb-3 flex flex-wrap items-center gap-3">
        <div className="min-w-56 flex-1"><Input label="Filter" placeholder="Name, brand or generic" value={filter} onChange={(e) => setFilter(e.target.value)} /></div>
        <label className="mt-6 flex min-h-12 items-center gap-2 font-semibold"><input type="checkbox" className="size-6 accent-brand-600" checked={lowOnly} onChange={(e) => setLowOnly(e.target.checked)} /> Low stock only</label>
      </div>

      <QueryBoundary query={q} skeleton={<SkeletonList rows={5} height="h-14" />} isEmpty={(d) => d.length === 0} empty={<EmptyState title="No stock added yet" body="Add stock one by one or upload a CSV from your billing software." />}>
        {(rows) => {
          const f = rows.filter((r) => `${r.name} ${r.brand} ${r.generic}`.toLowerCase().includes(filter.toLowerCase()) && (!lowOnly || r.low));
          if (!f.length) return <EmptyState title="No items match" />;
          return (
            <Card className="overflow-x-auto p-0 sm:p-0">
              <table className="w-full min-w-[44rem] text-left text-sm">
                <thead className="bg-stone-50 text-muted"><tr><th className="p-3">Medicine</th><th>Batch</th><th>Expiry</th><th>MRP</th><th>Price</th><th>Qty</th></tr></thead>
                <tbody>{f.map((r) => (
                  <tr key={r.id} className="border-t border-line align-middle">
                    <td className="p-3"><b>{r.name}</b><br /><span className="text-muted">{r.brand} · {r.generic}</span> {r.low && <Badge tone="amber"><AlertTriangle className="size-3" aria-hidden /> Low</Badge>}</td>
                    <td>{r.batch}</td><td className={r.expiringSoon ? "font-semibold text-warn" : ""}>{fmtDate(r.expiry)}</td><td>{inr(r.mrp)}</td><td>{inr(r.sellingPrice)}</td><td className="pr-3"><QtyCell key={`${r.id}-${r.quantity}`} row={r} /></td>
                  </tr>))}</tbody>
              </table>
            </Card>
          );
        }}
      </QueryBoundary>
      <p className="mt-3 text-sm text-muted">Integration-ready: the same upload endpoint (<code>/api/pharmacy/inventory/bulk</code>) can be called by your billing / POS software.</p>
    </>
  );
}
