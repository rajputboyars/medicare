import Link from "next/link";
import clsx from "clsx";
import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";

export type MetricTone = "neutral" | "attention" | "danger" | "success";

const FRAME: Record<MetricTone, string> = {
  neutral: "border-line bg-surface",
  attention: "border-warn-line bg-warn-50",
  danger: "border-emergency-line bg-emergency-50",
  success: "border-ok-line bg-ok-50",
};
const ICON_BG: Record<MetricTone, string> = {
  neutral: "bg-brand-50 text-brand-700",
  attention: "bg-white text-warn",
  danger: "bg-white text-emergency",
  success: "bg-white text-ok",
};

/** One number that matters. When `tone` is not neutral, `hint` says why in words (never colour alone). */
export function DashboardMetricCard({ label, value, hint, icon, tone = "neutral", href }: { label: string; value: ReactNode; hint?: ReactNode; icon?: ReactNode; tone?: MetricTone; href?: string }) {
  const body = (
    <>
      <div className="flex items-start justify-between gap-3">
        <p className="t-label text-muted">{label}</p>
        {icon && <span className={clsx("grid size-9 shrink-0 place-items-center rounded-control [&>svg]:size-5", ICON_BG[tone])} aria-hidden>{icon}</span>}
      </div>
      <p className="t-number mt-1 text-[1.75rem] leading-tight">{value}</p>
      {(hint || href) && (
        <p className="mt-1 flex items-center justify-between gap-2 t-caption">
          <span className={clsx(tone !== "neutral" && "font-semibold text-ink")}>{hint}</span>
          {href && <ChevronRight className="size-4 shrink-0 text-subtle" aria-hidden />}
        </p>
      )}
    </>
  );
  const cls = clsx("block h-full rounded-card border p-4 shadow-soft", FRAME[tone], href && "transition-shadow hover:shadow-raised");
  return href ? <Link href={href} className={cls}>{body}</Link> : <div className={cls}>{body}</div>;
}
