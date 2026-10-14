import { Check } from "lucide-react";
import clsx from "clsx";

export const DELIVERY_STEPS = ["Go to pharmacy", "Pickup code", "Go to customer", "Delivery code", "Done"] as const;

/** The five delivery steps. The current one is bold and numbered, finished ones show a tick. Never colour alone. */
export function DeliveryStepper({ current }: { current: number }) {
  return (
    <ol aria-label="Delivery steps" className="flex items-start justify-between gap-1">
      {DELIVERY_STEPS.map((label, i) => {
        const done = i < current;
        const now = i === current;
        return (
          <li key={label} aria-current={now ? "step" : undefined} className="flex min-w-0 flex-1 flex-col items-center gap-1 text-center">
            <span className={clsx("grid size-8 place-items-center rounded-full border-2 text-sm font-extrabold", done ? "border-ok bg-ok text-white" : now ? "border-brand-600 bg-brand-600 text-white" : "border-line-strong bg-surface text-muted")}>
              {done ? <Check className="size-4" aria-hidden /> : i + 1}
            </span>
            <span className={clsx("text-[0.7rem] leading-tight", now ? "font-extrabold text-ink" : "text-muted")}>{label}{done && <span className="sr-only"> (done)</span>}{now && <span className="sr-only"> (now)</span>}</span>
          </li>
        );
      })}
    </ol>
  );
}
