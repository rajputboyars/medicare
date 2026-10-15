import { Check } from "lucide-react";
import clsx from "clsx";

/**
 * "Step 2 of 5" with a bar and, optionally, step names. The current step is bold and numbered, finished ones show a tick,
 * so progress never depends on colour alone.
 */
export function StepProgress({ steps, current, label = "Progress", compact = false }: { steps: { key: string; label: string; done?: boolean }[]; current: number; label?: string; compact?: boolean }) {
  const pct = Math.round(((current + 1) / steps.length) * 100);
  return (
    <div aria-label={label}>
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <p className="t-label">Step {current + 1} of {steps.length}</p>
        <p className="t-caption">{steps[current]?.label}</p>
      </div>
      <div className="h-2 overflow-hidden rounded-pill bg-line" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={`${pct} percent`}>
        <div className="h-full rounded-pill bg-brand-600 transition-[width] duration-300" style={{ width: `${pct}%` }} />
      </div>
      {!compact && (
        <ol className="mt-3 hidden flex-wrap gap-x-4 gap-y-1 sm:flex">
          {steps.map((s, i) => (
            <li key={s.key} aria-current={i === current ? "step" : undefined} className={clsx("flex items-center gap-1.5 text-sm", i === current ? "font-extrabold text-ink" : "text-muted")}>
              <span className={clsx("grid size-5 place-items-center rounded-full border text-[0.7rem]", s.done ? "border-ok bg-ok text-white" : i === current ? "border-brand-600 bg-brand-600 text-white" : "border-line-strong")}>
                {s.done ? <Check className="size-3" aria-hidden /> : i + 1}
              </span>
              {s.label}
              {s.done && <span className="sr-only"> (done)</span>}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
