"use client";
import Link from "next/link";
import { CheckCircle2, Clock, HelpCircle, PackageX, Radar, SearchCheck } from "lucide-react";
import { Card, LinkButton, StatusBadge, type StatusTone } from "@/components/ui";
import { fmtAgo } from "@/lib/hooks";
import { inr } from "@/lib/pricing";
import type { MedicineRequest, MedicineRequestResponse } from "@/lib/types";

export type TrackedRequest = MedicineRequest & {
  responses: (MedicineRequestResponse & { pharmacyName?: string })[];
  asked: { id: string; name: string }[];
};

const REPLY: Record<MedicineRequestResponse["response"], { tone: StatusTone; label: string }> = {
  AVAILABLE: { tone: "success", label: "Has it" },
  ALTERNATIVE_AVAILABLE: { tone: "info", label: "Suggests another" },
  CAN_ARRANGE: { tone: "info", label: "Can arrange it" },
  NOT_AVAILABLE: { tone: "danger", label: "Not available" },
};

/**
 * Live view of a "Find My Medicine" request.
 * While searching: how many pharmacies were asked and who has replied. When one has it: a clear "We found your medicine".
 */
export function RequestTracker({ request: r }: { request: TrackedRequest }) {
  const byId = new Map(r.responses.map((x) => [x.pharmacyId, x]));
  const replied = r.asked.filter((p) => byId.has(p.id)).length;
  const found = r.status === "FOUND";
  const best = r.responses.filter((x) => x.response === "AVAILABLE").sort((a, b) => (a.price ?? 0) - (b.price ?? 0))[0];

  return (
    <Card className={found ? "border-ok-line" : "border-brand-200"} aria-live="polite">
      <div className="flex items-start gap-4">
        <span className={`grid size-14 shrink-0 place-items-center rounded-full ${found ? "bg-ok-50 text-ok" : "bg-brand-50 text-brand-700"}`} aria-hidden>
          {found ? <CheckCircle2 className="size-8" /> : <Radar className="size-8 motion-safe:animate-pulse" />}
        </span>
        <div className="min-w-0">
          <h2 className="t-section">{found ? "We found your medicine" : "Searching nearby pharmacies…"}</h2>
          <p className="t-support">
            {r.medicineQuery}{r.strength ? `, ${r.strength}` : ""} · {r.quantity} {r.quantity === 1 ? "unit" : "units"} · asked {fmtAgo(r.createdAt)}
          </p>
        </div>
      </div>

      <p className="mt-4 rounded-control bg-surface-2 p-3 text-base">
        We asked <b>{r.asked.length} {r.asked.length === 1 ? "pharmacy" : "pharmacies"}</b> near {r.pincode}.{" "}
        <b>{replied}</b> {replied === 1 ? "has" : "have"} replied{replied < r.asked.length && !found ? ". Usually within 30 minutes." : "."}
      </p>

      {found && best && (
        <div className="mt-3 rounded-control border border-ok-line bg-ok-50 p-3">
          <p className="t-card">{best.pharmacyName} has it</p>
          <p className="t-support text-ink">{best.price ? `${inr(best.price)} each` : "Price on order"}{best.availableQty ? ` · ${best.availableQty} available` : ""}{best.prepMinutes ? ` · ready in about ${best.prepMinutes} min` : ""}</p>
          <LinkButton href={`/medicines?q=${encodeURIComponent(r.medicineQuery)}`} size="lg" className="mt-3 w-full sm:w-auto"><SearchCheck className="size-5" aria-hidden /> Order it now</LinkButton>
        </div>
      )}

      <ul className="mt-3 divide-y divide-line" aria-label="Pharmacies asked">
        {r.asked.map((p) => {
          const x = byId.get(p.id);
          const meta = x ? REPLY[x.response] : undefined;
          return (
            <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
              <span className="font-semibold">{p.name}</span>
              {meta && x ? (
                <span className="flex flex-col items-end gap-0.5">
                  <StatusBadge tone={meta.tone} icon={x.response === "NOT_AVAILABLE" ? <PackageX className="size-3.5" aria-hidden /> : undefined}>{meta.label}</StatusBadge>
                  {x.response === "AVAILABLE" && x.price && <span className="t-caption">{inr(x.price)} · {x.availableQty ?? "?"} units · {x.prepMinutes ?? "?"} min</span>}
                  {x.response === "CAN_ARRANGE" && <span className="t-caption">{x.alternative ?? "Ask the pharmacy"}{x.restockEta ? ` · in ${x.restockEta}` : ""}</span>}
                  {x.response === "NOT_AVAILABLE" && x.restockEta && <span className="t-caption">Back in {x.restockEta}</span>}
                </span>
              ) : (
                <StatusBadge tone="neutral" icon={<Clock className="size-3.5" aria-hidden />}>Waiting for reply</StatusBadge>
              )}
            </li>
          );
        })}
        {!r.asked.length && <li className="flex items-center gap-2 py-2.5 t-support"><HelpCircle className="size-4" aria-hidden /> No pharmacy delivers to this pincode yet. <Link href="/" className="underline">Change area</Link></li>}
      </ul>
    </Card>
  );
}
