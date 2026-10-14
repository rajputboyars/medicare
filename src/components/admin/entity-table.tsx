"use client";
import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { fmtDateTime } from "@/lib/hooks";
import { inr } from "@/lib/pricing";
import { Card, EmptyState, PageTitle, QueryBoundary, SearchBar, SkeletonList, StatusBadge } from "@/components/ui";
import type { StatusTone } from "@/components/ui/status-badge";

export type Row = Record<string, unknown> & { id?: string };
export interface Column { key: string; label: string; render?: (v: unknown, row: Row) => ReactNode; className?: string }

export const money = (v: unknown) => inr(Number(v ?? 0));
export const when = (v: unknown) => (v ? fmtDateTime(String(v)) : "—");
export const yesNo = (v: unknown) => (v ? "Yes" : "No");
const TONES: Record<string, StatusTone> = {
  DELIVERED: "success", PAID: "success", VERIFIED: "success", RESOLVED: "success", FOUND: "success", AVAILABLE: "success",
  CANCELLED: "danger", FAILED: "danger", REJECTED: "danger", SUSPENDED: "danger", OPEN: "warning", PENDING: "warning", AUTHORIZED: "info", PARTIALLY_REFUNDED: "neutral",
  PROCESSING: "info", IN_PROGRESS: "info", REFUNDED: "neutral",
};
export const status = (v: unknown) => <StatusBadge tone={TONES[String(v)] ?? "info"}>{String(v).replace(/_/g, " ").toLowerCase()}</StatusBadge>;

const cell = (c: Column, r: Row) => (c.render ? c.render(r[c.key], r) : String(r[c.key] ?? "—"));

/** One list for every admin screen: loading, error + retry, empty, search. Cards on phones, a real table from 768px. */
export function EntityTable({ title, subtitle, queryKey, url, columns, rowAction, headerAction, searchable = true, emptyText = "Nothing to show yet" }: {
  title: string; subtitle?: string; queryKey: string; url: string; columns: Column[];
  rowAction?: (row: Row) => ReactNode; headerAction?: ReactNode; searchable?: boolean; emptyText?: string;
}) {
  const q = useQuery({ queryKey: ["admin", queryKey], queryFn: () => api<Row[]>(url), refetchInterval: 30_000 });
  const [term, setTerm] = useState("");
  return (
    <>
      <PageTitle title={title} subtitle={subtitle} action={headerAction} />
      {searchable && <div className="mb-3 max-w-md"><SearchBar value={term} onChange={setTerm} placeholder="Type to filter" label={`Search ${title.toLowerCase()}`} /></div>}
      <QueryBoundary query={q} skeleton={<SkeletonList rows={6} lines={2} />} isEmpty={(d) => d.length === 0} empty={<EmptyState title={emptyText} />}>
        {(rows) => {
          const f = term ? rows.filter((r) => JSON.stringify(r).toLowerCase().includes(term.toLowerCase())) : rows;
          if (!f.length) return <EmptyState title="Nothing matches your search" />;
          return (
            <>
              <ul className="space-y-3 md:hidden">
                {f.map((r, i) => (
                  <Card as="li" key={String(r.id ?? i)} className="space-y-1.5">
                    <div className="t-card">{cell(columns[0], r)}</div>
                    {columns.slice(1).map((c) => (
                      <div key={c.key} className="flex items-start justify-between gap-3 text-sm">
                        <span className="shrink-0 text-muted">{c.label}</span><span className="min-w-0 break-words text-right">{cell(c, r)}</span>
                      </div>
                    ))}
                    {rowAction && <div className="pt-1">{rowAction(r)}</div>}
                  </Card>
                ))}
              </ul>
              <Card className="hidden overflow-x-auto p-0 sm:p-0 md:block">
                <table className="w-full text-left text-sm">
                  <thead className="bg-surface-2 text-muted"><tr>{columns.map((c) => <th key={c.key} scope="col" className="p-3 font-semibold">{c.label}</th>)}{rowAction && <th scope="col"><span className="sr-only">Actions</span></th>}</tr></thead>
                  <tbody>{f.map((r, i) => (
                    <tr key={String(r.id ?? i)} className="border-t border-line align-top">
                      {columns.map((c) => <td key={c.key} className={`max-w-xs p-3 ${c.className ?? ""}`}>{cell(c, r)}</td>)}
                      {rowAction && <td className="p-3 text-right">{rowAction(r)}</td>}
                    </tr>))}</tbody>
                </table>
              </Card>
            </>
          );
        }}
      </QueryBoundary>
      <p className="t-caption mt-3">Medical content, delivery OTPs and file keys are never shown in admin tables.</p>
    </>
  );
}
