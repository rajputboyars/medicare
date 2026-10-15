"use client";
import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Download, FileSpreadsheet, HelpCircle, SearchX, Upload } from "lucide-react";
import { api, post, upload } from "@/lib/api";
import { Button, Modal, Notice, StatusBadge, Success } from "@/components/ui";
import type { ImportRow, ImportRowStatus } from "@/lib/types";

interface Preview { id: string; fileName: string; total: number; counts: Record<ImportRowStatus, number>; rows: ImportRow[] }
interface Result { imported: number; sentToReview: number; total: number }

const LABEL: Record<ImportRowStatus, { title: string; hint: string; tone: "success" | "warning" | "danger" | "neutral"; icon: typeof CheckCircle2 }> = {
  MATCHED: { title: "Matched", hint: "Found in the catalogue. Will be imported.", tone: "success", icon: CheckCircle2 },
  POSSIBLE_MATCH: { title: "Please check", hint: "Close to a catalogue medicine. Choose the right one, or skip.", tone: "warning", icon: HelpCircle },
  NOT_FOUND: { title: "Not in catalogue", hint: "Sent to our team to add or match. Nothing is created automatically.", tone: "neutral", icon: SearchX },
  INVALID: { title: "Has a problem", hint: "Will be skipped. Fix the file and upload again.", tone: "danger", icon: AlertTriangle },
};

/**
 * CSV import in three calm steps: choose file → check the preview → confirm. Nothing is saved until the pharmacy confirms.
 * Rows that look like a catalogue medicine but are not certain are shown with choices; unknown medicines are never created here.
 */
export function ImportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const file = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<Preview>();
  const [choices, setChoices] = useState<Record<string, string>>({});
  const [result, setResult] = useState<Result>();
  const [show, setShow] = useState<ImportRowStatus | "ALL">("POSSIBLE_MATCH");

  const reset = () => { setPreview(undefined); setChoices({}); setResult(undefined); };
  const close = () => { reset(); onClose(); };

  const send = useMutation({
    mutationFn: (f: File) => { const fd = new FormData(); fd.set("file", f); return upload<Preview>("/api/pharmacy/inventory/import", fd); },
    onSuccess: (p) => { setPreview(p); setShow(p.counts.POSSIBLE_MATCH ? "POSSIBLE_MATCH" : p.counts.INVALID ? "INVALID" : "ALL"); },
  });
  const confirm = useMutation({
    mutationFn: () => post<Result>(`/api/pharmacy/inventory/import/${preview!.id}/confirm`, { choices }),
    onSuccess: (r) => { setResult(r); void qc.invalidateQueries({ queryKey: ["inventory"] }); void qc.invalidateQueries({ queryKey: ["pharmacy-dashboard"] }); },
  });

  async function template() {
    const t = await api<{ filename: string; csv: string }>("/api/pharmacy/inventory/import");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([t.csv], { type: "text/csv" })); a.download = t.filename; a.click();
  }

  const rows = preview?.rows.filter((r) => show === "ALL" || r.status === show) ?? [];
  const willImport = preview ? preview.counts.MATCHED + Object.values(choices).filter((c) => c !== "SKIP").length : 0;

  return (
    <Modal open={open} onClose={close} title="Import stock from a file" description={result ? undefined : "Upload a CSV from your billing software. You will check it before anything is saved."}>
      {result ? (
        <div className="space-y-3">
          <Success title={`${result.imported} ${result.imported === 1 ? "line" : "lines"} added to your stock`}>
            {result.sentToReview > 0 ? `${result.sentToReview} medicine${result.sentToReview === 1 ? " was" : "s were"} not in our catalogue. Our team will add or match ${result.sentToReview === 1 ? "it" : "them"} and let you know.` : "Everything was matched."}
          </Success>
          <Button className="w-full" onClick={close}>Done</Button>
        </div>
      ) : !preview ? (
        <div className="space-y-3">
          {send.isError && <Notice tone="red">{(send.error as Error).message}</Notice>}
          <p className="t-support">Columns: <b>medicine_name, batch, expiry, mrp, selling_price, stock</b>. Optional: generic_name, strength, manufacturer.</p>
          <Button size="lg" className="w-full" loading={send.isPending} onClick={() => file.current?.click()}><Upload className="size-5" aria-hidden /> Choose CSV file</Button>
          <input ref={file} type="file" accept=".csv" className="hidden" aria-label="Choose a CSV file" onChange={(e) => { const f = e.target.files?.[0]; if (f) send.mutate(f); e.target.value = ""; }} />
          <Button variant="ghost" className="w-full" onClick={() => void template()}><Download className="size-5" aria-hidden /> Download a sample file</Button>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="flex items-center gap-2 font-bold"><FileSpreadsheet className="size-5 text-brand-600" aria-hidden /> {preview.fileName} · {preview.total} rows</p>
          <div className="grid grid-cols-2 gap-2" role="group" aria-label="Show rows">
            {(Object.keys(LABEL) as ImportRowStatus[]).map((k) => {
              const L = LABEL[k];
              return (
                <button key={k} type="button" aria-pressed={show === k} onClick={() => setShow(k)} className={`tap rounded-control border-2 p-2 text-left ${show === k ? "border-brand-600 bg-brand-50" : "border-line-strong"}`}>
                  <span className="t-number text-lg">{preview.counts[k]}</span> <span className="text-sm font-bold">{L.title}</span>
                </button>
              );
            })}
          </div>
          {show !== "ALL" && <p className="t-caption">{LABEL[show].hint}</p>}
          {confirm.isError && <Notice tone="red">{(confirm.error as Error).message}</Notice>}
          <ul className="max-h-72 space-y-2 overflow-y-auto" aria-label="Rows">
            {rows.slice(0, 100).map((r) => {
              const L = LABEL[r.status];
              return (
                <li key={r.line} className="rounded-control border border-line p-3 text-sm">
                  <p className="flex flex-wrap items-center gap-2"><StatusBadge tone={L.tone} icon={<L.icon className="size-3.5" aria-hidden />}>{L.title}</StatusBadge><b>{r.input.medicineName || "(no name)"}</b> {r.input.strength} <span className="t-caption">line {r.line}</span></p>
                  {r.errors?.map((e) => <p key={e} className="mt-1 text-emergency">{e}</p>)}
                  {r.status === "POSSIBLE_MATCH" && (
                    <label className="mt-2 block text-sm font-semibold">Is it one of these?
                      <select className="tap mt-1 w-full rounded-control border-2 border-line-strong bg-surface px-2" value={choices[String(r.line)] ?? ""} onChange={(e) => setChoices((c) => { const n = { ...c }; if (e.target.value) n[String(r.line)] = e.target.value; else delete n[String(r.line)]; return n; })}>
                        <option value="">Not sure: let the team check</option>
                        {r.candidates?.map((c) => <option key={c.medicineId} value={c.medicineId}>{c.name} {c.strength}</option>)}
                        <option value="SKIP">None of these: skip</option>
                      </select>
                    </label>
                  )}
                </li>
              );
            })}
            {rows.length === 0 && <li className="t-caption">Nothing here.</li>}
            {rows.length > 100 && <li className="t-caption">Showing the first 100 of {rows.length}.</li>}
          </ul>
          <div className="flex flex-wrap gap-2 pt-1">
            <Button size="lg" loading={confirm.isPending} disabled={willImport === 0 && preview.counts.NOT_FOUND === 0} onClick={() => confirm.mutate()}>Import {willImport} {willImport === 1 ? "line" : "lines"}</Button>
            <Button variant="secondary" size="lg" onClick={() => { void api(`/api/pharmacy/inventory/import/${preview.id}`, { method: "DELETE" }).catch(() => undefined); reset(); }}>Choose another file</Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
