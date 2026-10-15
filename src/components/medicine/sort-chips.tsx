"use client";
import clsx from "clsx";
import { Clock, MapPin, Tag, type LucideIcon } from "lucide-react";

export type Sort = "FASTEST" | "CHEAPEST" | "NEAREST";

const OPTIONS: { value: Sort; label: string; icon: LucideIcon }[] = [
  { value: "FASTEST", label: "Fastest", icon: Clock },
  { value: "CHEAPEST", label: "Cheapest", icon: Tag },
  { value: "NEAREST", label: "Nearest", icon: MapPin },
];

/** Fastest / Cheapest / Nearest. One tap, one choice; the selected chip is filled and bold, not just a different colour. */
export function SortChips({ value, onChange, label = "Sort by" }: { value: Sort; onChange: (s: Sort) => void; label?: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-2">
      {OPTIONS.map((o) => {
        const on = value === o.value;
        return (
          <button key={o.value} type="button" role="radio" aria-checked={on} onClick={() => onChange(o.value)}
            className={clsx("tap inline-flex items-center gap-1.5 rounded-pill border-2 px-4 text-sm", on ? "border-brand-600 bg-brand-600 font-bold text-white" : "border-line-strong bg-surface font-semibold hover:bg-surface-2")}>
            <o.icon className="size-4" aria-hidden /> {o.label}
          </button>
        );
      })}
    </div>
  );
}
