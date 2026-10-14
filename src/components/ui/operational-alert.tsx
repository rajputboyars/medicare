import Link from "next/link";
import clsx from "clsx";
import { AlertOctagon, AlertTriangle, ArrowRight, Info } from "lucide-react";

export type AlertSeverity = "info" | "warning" | "critical";

const FRAME: Record<AlertSeverity, string> = {
  info: "border-info-line bg-info-50",
  warning: "border-warn-line bg-warn-50",
  critical: "border-emergency-line bg-emergency-50",
};
const ICON = { info: Info, warning: AlertTriangle, critical: AlertOctagon };
const WORD: Record<AlertSeverity, string> = { info: "Info", warning: "Needs attention", critical: "Urgent" };
const TEXT: Record<AlertSeverity, string> = { info: "text-info", warning: "text-warn", critical: "text-emergency" };

/** Something an operator should act on now: stuck order, pending approval, unanswered request. */
export function OperationalAlert({ severity = "warning", title, description, action }: {
  severity?: AlertSeverity; title: string; description?: string; action?: { label: string; href: string };
}) {
  const Icon = ICON[severity];
  return (
    <div role={severity === "critical" ? "alert" : undefined} className={clsx("flex items-start gap-3 rounded-card border p-4", FRAME[severity])}>
      <Icon className={clsx("mt-0.5 size-6 shrink-0", TEXT[severity])} aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="t-card">
          <span className={clsx("mr-2 text-xs font-bold uppercase tracking-wide", TEXT[severity])}>{WORD[severity]}</span>
          {title}
        </p>
        {description && <p className="t-support mt-0.5">{description}</p>}
      </div>
      {action && (
        <Link href={action.href} className="tap inline-flex shrink-0 items-center gap-1.5 self-center rounded-control border border-line-strong bg-surface px-3 text-sm font-semibold hover:bg-surface-2">
          {action.label} <ArrowRight className="size-4" aria-hidden />
        </Link>
      )}
    </div>
  );
}
