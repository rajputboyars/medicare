import clsx from "clsx";
import { AlertTriangle, CheckCircle2, Circle, Clock, Info, XCircle } from "lucide-react";
import type { ReactNode } from "react";

export type StatusTone = "success" | "warning" | "danger" | "info" | "neutral";

const STYLE: Record<StatusTone, string> = {
  success: "bg-ok-50 text-ok border-ok-line",
  warning: "bg-warn-50 text-warn border-warn-line",
  danger: "bg-emergency-50 text-emergency border-emergency-line",
  info: "bg-info-50 text-info border-info-line",
  neutral: "bg-surface-2 text-muted border-line",
};
const ICON: Record<StatusTone, typeof Info> = { success: CheckCircle2, warning: Clock, danger: XCircle, info: Info, neutral: Circle };

/**
 * A status is never colour alone: every badge carries an icon AND words.
 * Use for anything with a state (order, payment, verification, request). Use `Badge` for plain labels like "Rx".
 */
export function StatusBadge({ tone = "neutral", icon, children, className }: { tone?: StatusTone; icon?: ReactNode | false; children: ReactNode; className?: string }) {
  const Icon = ICON[tone];
  return (
    <span className={clsx("inline-flex items-center gap-1.5 rounded-pill border px-2.5 py-1 text-xs font-semibold leading-none", STYLE[tone], className)}>
      {icon === false ? null : icon ?? <Icon className="size-3.5 shrink-0" aria-hidden />}
      <span>{children}</span>
    </span>
  );
}

/** Warning triangle variant for things that need attention (low stock, expiring). */
export function AttentionBadge({ children }: { children: ReactNode }) {
  return <StatusBadge tone="warning" icon={<AlertTriangle className="size-3.5 shrink-0" aria-hidden />}>{children}</StatusBadge>;
}
