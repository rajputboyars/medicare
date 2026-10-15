"use client";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Minus, Pencil, Plus, Upload } from "lucide-react";
import clsx from "clsx";
import type { z } from "zod";
import { api, patch, post, put } from "@/lib/api";
import { ImportDialog } from "@/components/pharmacy/import-dialog";
import { inventoryItemSchema } from "@/lib/validation";
import { fmtAgo, fmtDate } from "@/lib/hooks";
import { inr } from "@/lib/pricing";
import { Button, Card, EmptyState, IconButton, Input, Modal, Notice, PageTitle, QueryBoundary, SearchBar, Select, SkeletonList, StatusBadge } from "@/components/ui";

interface Row { id: string; medicineId: string; name: string; brand: string; generic: string; strength: string; batch: string; expiry: string; mrp: number; sellingPrice: number; stockQuantity: number; reservedQuantity: number; availableQuantity: number; lowStockThreshold: number; low: boolean; expiringSoon: boolean; lastUpdatedAt?: string; expiryState: "EXPIRED" | "EXPIRING_30" | "EXPIRING_90" | "OK"; daysToExpiry: number; confidence: "HIGH" | "MEDIUM" | "LOW"; sellable: boolean; outOfStock: boolean; status: "ACTIVE" | "INACTIVE" }
type Form = z.input<typeof inventoryItemSchema>;
type Filter = "all" | "low" | "out" | "exp30" | "exp90" | "expired";

const matches: Record<Filter, (r: Row) => boolean> = {
  all: () => true,
  low: (r) => r.low && r.stockQuantity > 0 && r.expiryState !== "EXPIRED",
  out: (r) => r.availableQuantity === 0 && r.expiryState !== "EXPIRED",
  exp30: (r) => r.expiryState === "EXPIRING_30",
  exp90: (r) => r.expiryState === "EXPIRING_30" || r.expiryState === "EXPIRING_90",
  expired: (r) => r.expiryState === "EXPIRED",
};
const FILTERS: [Filter, string][] = [["all", "All"], ["low", "Low stock"], ["out", "Out of stock"], ["exp30", "Expires in 30 days"], ["exp90", "Expires in 90 days"], ["expired", "Expired"]];

/**
 * Fix the stock in a tap (− / +) or type the exact number. Saves immediately and shows the new number straight away.
 * It never goes below zero or below the units already promised to open orders (the server enforces this too).
 */
function StockStepper({ row }: { row: Row }) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState<string>();
  const [error, setError] = useState<string>();
  const set = useMutation({
    mutationFn: (body: { stockQuantity: number } | { delta: number }) => patch(`/api/pharmacy/inventory/${row.id}/stock`, body),
    onMutate: async (body) => {
      setError(undefined);
      await qc.cancelQueries({ queryKey: ["inventory"] });
      const prev = qc.getQueryData<Row[]>(["inventory"]);
      const next = "delta" in body ? row.stockQuantity + body.delta : body.stockQuantity;
      qc.setQueryData<Row[]>(["inventory"], (rows) => rows?.map((r) => (r.id === row.id ? { ...r, stockQuantity: next, availableQuantity: Math.max(0, next - r.reservedQuantity), low: next <= r.lowStockThreshold, lastUpdatedAt: new Date().toISOString() } : r)));
      return { prev };
    },
    onError: (e, _q, ctx) => { if (ctx?.prev) qc.setQueryData(["inventory"], ctx.prev); setError((e as Error).message); },
    onSettled: () => { setDraft(undefined); qc.invalidateQueries({ queryKey: ["inventory"] }); qc.invalidateQueries({ queryKey: ["pharmacy-dashboard"] }); },
  });
  const commit = () => {
    if (draft === undefined) return;
    const n = Number(draft);
    if (!/^\d+$/.test(draft) || !Number.isInteger(n)) { setError("Type a whole number"); setDraft(undefined); return; }
    if (n !== row.stockQuantity) set.mutate({ stockQuantity: n }); else setDraft(undefined);
  };
  return (
    <div>
      <div className="flex items-center gap-1" role="group" aria-label={`Stock of ${row.name}`}>
        <IconButton label={`One less ${row.name}`} className="border border-line-strong bg-surface" disabled={row.stockQuantity <= row.reservedQuantity} onClick={() => set.mutate({ delta: -1 })}><Minus className="size-5" aria-hidden /></IconButton>
        <input aria-label={`Exact stock of ${row.name}`} inputMode="numeric" value={draft ?? String(row.stockQuantity)} onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => setDraft(e.target.value.replace(/\D/g, ""))} onBlur={commit} onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") setDraft(undefined); }}
          className={clsx("h-12 w-20 rounded-control border-2 border-line bg-surface text-center text-xl font-extrabold tabular-nums", row.stockQuantity === 0 && "text-emergency", row.low && row.stockQuantity > 0 && "text-warn")} />
        <IconButton label={`One more ${row.name}`} className="border border-line-strong bg-surface" onClick={() => set.mutate({ delta: 1 })}><Plus className="size-5" aria-hidden /></IconButton>
      </div>
      {error && <p role="alert" className="mt-1 max-w-56 text-sm font-semibold text-emergency">{error}</p>}
    </div>
  );
}

function StockForm({ row, onDone }: { row?: Row; onDone: () => void }) {
  const qc = useQueryClient();
  const meta = useQuery({ queryKey: ["catalog"], queryFn: () => api<{ catalog: { id: string; name: string; strength: string }[] }>("/api/medicines/meta"), enabled: !row });
  const { register, handleSubmit, formState: { errors } } = useForm<Form>({
    resolver: zodResolver(inventoryItemSchema),
    defaultValues: row ? { medicineId: row.medicineId, batch: row.batch, expiry: row.expiry.slice(0, 10), mrp: row.mrp, sellingPrice: row.sellingPrice, stockQuantity: row.stockQuantity, lowStockThreshold: row.lowStockThreshold } : { lowStockThreshold: 10 },
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
      <Input label="Quantity" required inputMode="numeric" error={errors.stockQuantity?.message} {...register("stockQuantity")} />
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
  const q = useQuery({ queryKey: ["inventory"], queryFn: () => api<Row[]>("/api/pharmacy/inventory") });
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Row>();
  const [text, setText] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [importing, setImporting] = useState(false);

  return (
    <>
      <PageTitle title="Inventory" subtitle="Keep stock correct so customers see what you really have." action={
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => setAdding(true)}><Plus className="size-5" aria-hidden /> Add stock</Button>
          <Button variant="secondary" onClick={() => setImporting(true)}><Upload className="size-5" aria-hidden /> Import CSV</Button>
        </div>} />

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
                        {r.availableQuantity === 0 && r.expiryState !== "EXPIRED" ? <StatusBadge tone="danger" icon={<AlertTriangle className="size-3.5" aria-hidden />}>Out of stock</StatusBadge> : r.low && r.expiryState !== "EXPIRED" && <StatusBadge tone="warning" icon={<AlertTriangle className="size-3.5" aria-hidden />}>Low stock</StatusBadge>}
                        {r.expiryState === "EXPIRED" ? <StatusBadge tone="danger" icon={<AlertTriangle className="size-3.5" aria-hidden />}>Expired · not sold</StatusBadge> : r.expiringSoon && <StatusBadge tone="warning">Expires in {r.daysToExpiry} days</StatusBadge>}
                        {r.confidence === "LOW" && <StatusBadge tone="neutral">Count not updated for a while</StatusBadge>}
                        {r.reservedQuantity > 0 && <StatusBadge tone="info">{r.reservedQuantity} promised to orders</StatusBadge>}
                        <span className="t-caption">Batch {r.batch} · expiry {fmtDate(r.expiry)}{r.lastUpdatedAt ? ` · updated ${fmtAgo(r.lastUpdatedAt)}` : ""}</span>
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
      <ImportDialog open={importing} onClose={() => setImporting(false)} />
      <p className="t-caption mt-4">Expired stock is kept for your records but is never shown to customers or sold.</p>
    </>
  );
}
