"use client";
import clsx from "clsx";
import { Clock, MapPin, Store, Tag, type LucideIcon } from "lucide-react";

export type Strategy = "fastest" | "cheapest" | "nearest" | "preferred";

const OPTIONS: { value: Strategy; label: string; icon: LucideIcon }[] = [
  { value: "fastest", label: "Fastest", icon: Clock },
  { value: "cheapest", label: "Cheapest", icon: Tag },
  { value: "nearest", label: "Nearest", icon: MapPin },
  { value: "preferred", label: "My pharmacy", icon: Store },
];

/** Fastest / Cheapest / Nearest (and optionally "My pharmacy"). One tap, one choice; selected chip has a tick-style fill and bold text. */
export function SortChips({ value, onChange, includePreferred = false, label = "Choose by" }: { value: Strategy; onChange: (s: Strategy) => void; includePreferred?: boolean; label?: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-2">
      {OPTIONS.filter((o) => includePreferred || o.value !== "preferred").map((o) => {
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
