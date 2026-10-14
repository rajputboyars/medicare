"use client";
import Link from "next/link";
import clsx from "clsx";
import { AlertTriangle, ArrowLeft, CheckCircle2, ChevronRight, Inbox, RefreshCw, ShieldCheck, WifiOff } from "lucide-react";
import type { ReactNode } from "react";
import type { UseQueryResult } from "@tanstack/react-query";
import { ApiClientError } from "@/lib/api";
import { Button } from "./button";
import { DashboardMetricCard } from "./dashboard-metric-card";
import { SkeletonList } from "./skeleton-card";

// Re-exports: import everything UI from "@/components/ui".
export { Button, LinkButton, IconButton, buttonClass } from "./button";
export type { ButtonVariant, ButtonSize } from "./button";
export { Input, Select, Textarea, Toggle } from "./form";
export { StatusBadge, AttentionBadge } from "./status-badge";
export type { StatusTone } from "./status-badge";
export { DashboardMetricCard } from "./dashboard-metric-card";
export { OperationalAlert } from "./operational-alert";
export { Skeleton, SkeletonCard, SkeletonMetric, SkeletonList } from "./skeleton-card";
export { Modal } from "./modal";
export { ConfirmationDialog } from "./confirmation-dialog";
export { SearchBar } from "./search-bar";
export { LazyMount } from "./lazy-mount";

export function Card({ className, children, as: Tag = "div", ...rest }: { className?: string; children: ReactNode; as?: "div" | "section" | "article" | "li" } & React.HTMLAttributes<HTMLElement>) {
  return (
    <Tag {...rest} className={clsx("rounded-card border border-line bg-surface p-4 shadow-soft sm:p-5", className)}>
      {children}
    </Tag>
  );
}

type PlainTone = "green" | "amber" | "red" | "gray" | "blue";
const PLAIN: Record<PlainTone, string> = {
  green: "bg-ok-50 text-ok border-ok-line",
  amber: "bg-warn-50 text-warn border-warn-line",
  red: "bg-emergency-50 text-emergency border-emergency-line",
  gray: "bg-surface-2 text-muted border-line",
  blue: "bg-info-50 text-info border-info-line",
};
/** Plain label chip (Rx, Priority, Brand…). For anything with a *state*, use StatusBadge, which also shows an icon. */
export function Badge({ tone = "gray", children, className }: { tone?: PlainTone; children: ReactNode; className?: string }) {
  return <span className={clsx("inline-flex items-center gap-1 rounded-pill border px-2.5 py-1 text-xs font-semibold leading-none", PLAIN[tone], className)}>{children}</span>;
}

export function Verified({ label = "Verified" }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-pill border border-ok-line bg-ok-50 px-2.5 py-1 text-xs font-semibold leading-none text-ok">
      <ShieldCheck className="size-3.5" aria-hidden /> {label}
    </span>
  );
}

export function EmptyState({ title, body, action, icon }: { title: string; body?: string; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-card border-2 border-dashed border-line-strong bg-surface/60 px-6 py-10 text-center">
      <span className="grid size-14 place-items-center rounded-full bg-brand-50 text-brand-600 [&>svg]:size-7" aria-hidden>{icon ?? <Inbox />}</span>
      <h3 className="t-card">{title}</h3>
      {body && <p className="t-support max-w-md">{body}</p>}
      {action}
    </div>
  );
}

/** Error with a retry. Knows the difference between "the server said no" and "you have no signal". */
export function ErrorState({ message, onRetry, offline }: { message?: string; onRetry?: () => void; offline?: boolean }) {
  const off = offline || (typeof navigator !== "undefined" && !navigator.onLine);
  return (
    <div role="alert" className={clsx("flex flex-col items-center gap-3 rounded-card border px-6 py-8 text-center", off ? "border-warn-line bg-warn-50" : "border-emergency-line bg-emergency-50")}>
      {off ? <WifiOff className="size-9 text-warn" aria-hidden /> : <AlertTriangle className="size-9 text-emergency" aria-hidden />}
      <p className="t-card">{off ? "You are offline" : "Something went wrong"}</p>
      <p className="t-support max-w-sm">{off ? "Check your internet connection. Your cart is saved on this phone." : message ?? "Please try again."}</p>
      {onRetry && <Button variant="secondary" onClick={onRetry}><RefreshCw className="size-4" aria-hidden /> Try again</Button>}
    </div>
  );
}

export function Notice({ tone = "amber", title, children }: { tone?: "amber" | "red" | "green" | "blue"; title?: string; children: ReactNode }) {
  const t = { amber: "border-warn-line bg-warn-50", red: "border-emergency-line bg-emergency-50", green: "border-ok-line bg-ok-50", blue: "border-info-line bg-info-50" }[tone];
  return (
    <div role={tone === "red" ? "alert" : "note"} className={clsx("rounded-card border p-4", t)}>
      {title && <p className="t-card mb-1">{title}</p>}
      <div className="t-support text-ink">{children}</div>
    </div>
  );
}

export function Success({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div role="status" className="flex items-start gap-3 rounded-card border border-ok-line bg-ok-50 p-4">
      <CheckCircle2 className="mt-0.5 size-6 shrink-0 text-ok" aria-hidden />
      <div><p className="t-card">{title}</p>{children && <div className="t-support text-ink">{children}</div>}</div>
    </div>
  );
}

/** One place that handles loading / offline / error (with retry) / empty / data for every query-driven screen. */
export function QueryBoundary<T>({ query, skeleton, empty, isEmpty, children }: {
  query: UseQueryResult<T>;
  skeleton?: ReactNode;
  empty?: ReactNode;
  isEmpty?: (d: T) => boolean;
  children: (data: T) => ReactNode;
}) {
  if (query.isPending) return <>{skeleton ?? <SkeletonList />}</>;
  if (query.isError) {
    const err = query.error as Error;
    return <ErrorState message={err.message} offline={err instanceof ApiClientError && err.status === 0} onRetry={() => query.refetch()} />;
  }
  if (isEmpty?.(query.data) && empty) return <>{empty}</>;
  return <>{children(query.data)}</>;
}

/** Page heading. `back` adds a clear way out on deep screens. */
export function PageTitle({ title, subtitle, action, back }: { title: string; subtitle?: string; action?: ReactNode; back?: { href: string; label: string } }) {
  return (
    <div className="mb-5">
      {back && <Link href={back.href} className="tap -ml-2 mb-1 inline-flex items-center gap-1 rounded-control px-2 text-sm font-semibold text-brand-700 hover:bg-brand-50"><ArrowLeft className="size-4" aria-hidden /> {back.label}</Link>}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="t-page">{title}</h1>
          {subtitle && <p className="t-support mt-1 max-w-prose">{subtitle}</p>}
        </div>
        {action}
      </div>
    </div>
  );
}
export { PageTitle as PageHeader };

/** Section heading with an optional "See all" link. Used on every screen that has sections. */
export function SectionHeader({ title, href, linkLabel = "See all", id, action }: { title: string; href?: string; linkLabel?: string; id?: string; action?: ReactNode }) {
  return (
    <div className="mb-3 flex items-end justify-between gap-3">
      <h2 id={id} className="t-section">{title}</h2>
      {action ?? (href && <Link href={href} className="tap inline-flex items-center gap-0.5 text-sm font-bold text-brand-700">{linkLabel} <ChevronRight className="size-4" aria-hidden /></Link>)}
    </div>
  );
}

/** Short form of DashboardMetricCard for simple label + value tiles. */
export function Stat({ label, value, tone, hint }: { label: string; value: ReactNode; tone?: "warn" | "ok" | "red"; hint?: ReactNode }) {
  return <DashboardMetricCard label={label} value={value} hint={hint} tone={tone === "warn" ? "attention" : tone === "red" ? "danger" : tone === "ok" ? "success" : "neutral"} />;
}
