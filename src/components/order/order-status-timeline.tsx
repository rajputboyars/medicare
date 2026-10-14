import clsx from "clsx";
import { Check } from "lucide-react";
import { describeDone, describeStatus } from "@/lib/order-copy";
import { timeline } from "@/lib/order-machine";
import { fmtDateTime } from "@/lib/hooks";
import type { Order } from "@/lib/types";
import { STATUS_ICON } from "./order-status-badge";

/**
 * Vertical order timeline. Every step says what is happening in plain words; the current step is
 * marked with text ("Now") as well as colour, and completed steps with a tick and "Done".
 */
export function OrderStatusTimeline({ order, pharmacy, rider }: {
  order: Pick<Order, "items" | "statusHistory" | "status" | "cancelReason">;
  pharmacy?: string;
  rider?: string;
}) {
  const steps = timeline(order);
  const first = (rider ?? "").split(" ")[0] || undefined;
  return (
    <ol className="relative" aria-label="Order progress">
      {steps.map((s, i) => {
        const Icon = STATUS_ICON[s.status];
        const last = i === steps.length - 1;
        const done = s.done && !s.current; // the current step is "now", not "done"
        return (
          <li key={s.status} aria-current={s.current ? "step" : undefined} className="relative flex gap-3 pb-5 last:pb-0">
            {!last && <span aria-hidden className={clsx("absolute left-[1.05rem] top-9 bottom-0 w-0.5 -translate-x-1/2", done ? "bg-brand-600" : "bg-line-strong")} />}
            <span className={clsx("relative z-10 grid size-9 shrink-0 place-items-center rounded-full border-2",
              done ? "border-brand-600 bg-brand-600 text-white" : s.current ? "border-brand-600 bg-brand-50 text-brand-700 ring-4 ring-brand-100" : "border-line-strong bg-surface text-subtle")}>
              {done ? <Check className="size-4" aria-hidden /> : <Icon className="size-4" aria-hidden />}
            </span>
            <div className="min-w-0 pt-0.5">
              <p className={clsx("t-card", !done && !s.current && "text-muted")}>
                {s.label}
                {s.current && <span className="ml-2 rounded-pill bg-brand-600 px-2 py-0.5 align-middle text-[0.7rem] font-bold uppercase tracking-wide text-white">Now</span>}
                <span className="sr-only">{done ? " (done)" : s.current ? " (current step)" : " (not yet)"}</span>
              </p>
              {(done || s.current) && <p className="t-support">{(done ? describeDone : describeStatus)(s.status, { pharmacy, rider: first, note: order.cancelReason })}</p>}
              {s.at && <p className="t-caption">{fmtDateTime(s.at)}</p>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
