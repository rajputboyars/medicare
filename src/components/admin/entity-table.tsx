"use client";
import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { fmtDateTime } from "@/lib/hooks";
import { inr } from "@/lib/pricing";
import { Badge, Card, EmptyState, Input, PageTitle, QueryBoundary, SkeletonList } from "@/components/ui";

export type Row = Record<string, unknown> & { id?: string };
export interface Column { key: string; label: string; render?: (v: unknown, row: Row) => ReactNode; className?: string }

export const money = (v: unknown) => inr(Number(v ?? 0));
export const when = (v: unknown) => (v ? fmtDateTime(String(v)) : "—");
export const yesNo = (v: unknown) => (v ? "Yes" : "No");
const TONES: Record<string, "green" | "amber" | "red" | "blue" | "gray"> = {
  DELIVERED: "green", PAID: "green", VERIFIED: "green", RESOLVED: "green", FOUND: "green", AVAILABLE: "green",
  CANCELLED: "red", FAILED: "red", REJECTED: "red", SUSPENDED: "red", OPEN: "amber", PENDING: "amber", COD_DUE: "amber", PROCESSING: "blue", IN_PROGRESS: "blue", REFUNDED: "gray",
};
export const status = (v: unknown) => <Badge tone={TONES[String(v)] ?? "blue"}>{String(v).replace(/_/g, " ").toLowerCase()}</Badge>;

/** One table for every admin list: loading, error+retry, empty, search filter, mobile horizontal scroll. */
export function EntityTable({ title, subtitle, queryKey, url, columns, rowAction, headerAction, searchable = true, emptyText = "Nothing to show yet" }: {
  title: string; subtitle?: string; queryKey: string; url: string; columns: Column[];
  rowAction?: (row: Row) => ReactNode; headerAction?: ReactNode; searchable?: boolean; emptyText?: string;
}) {
  const q = useQuery({ queryKey: ["admin", queryKey], queryFn: () => api<Row[]>(url), refetchInterval: 30_000 });
  const [term, setTerm] = useState("");
  return (
    <>
      <PageTitle title={title} subtitle={subtitle} action={headerAction} />
      {searchable && <div className="mb-3 max-w-sm"><Input label="Search" placeholder="Type to filter…" value={term} onChange={(e) => setTerm(e.target.value)} /></div>}
      <QueryBoundary query={q} skeleton={<SkeletonList rows={6} height="h-12" />} isEmpty={(d) => d.length === 0} empty={<EmptyState title={emptyText} />}>
        {(rows) => {
          const f = term ? rows.filter((r) => JSON.stringify(r).toLowerCase().includes(term.toLowerCase())) : rows;
          if (!f.length) return <EmptyState title="Nothing matches your search" />;
          return (
            <Card className="overflow-x-auto p-0 sm:p-0">
              <table className="w-full min-w-[44rem] text-left text-sm">
                <thead className="bg-stone-50 text-muted"><tr>{columns.map((c) => <th key={c.key} className="p-3 font-semibold">{c.label}</th>)}{rowAction && <th />}</tr></thead>
                <tbody>{f.map((r, i) => (
                  <tr key={String(r.id ?? i)} className="border-t border-line align-top">
                    {columns.map((c) => <td key={c.key} className={`max-w-xs p-3 ${c.className ?? ""}`}>{c.render ? c.render(r[c.key], r) : String(r[c.key] ?? "—")}</td>)}
                    {rowAction && <td className="p-3 text-right">{rowAction(r)}</td>}
                  </tr>))}</tbody>
              </table>
            </Card>
          );
        }}
      </QueryBoundary>
      <p className="mt-2 text-xs text-muted">Medical content, delivery OTPs and file keys are never shown in admin tables.</p>
    </>
  );
}
