"use client";
import Link from "next/link";
import clsx from "clsx";
import { AlertTriangle, CheckCircle2, Inbox, Loader2, RefreshCw, ShieldCheck } from "lucide-react";
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";
import { forwardRef, useId } from "react";
import type { UseQueryResult } from "@tanstack/react-query";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "soft";
const base = "inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl px-5 py-3 text-base font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50";
const variants: Record<Variant, string> = {
  primary: "bg-brand-600 text-white hover:bg-brand-700 active:bg-brand-800",
  secondary: "border-2 border-brand-600 bg-white text-brand-700 hover:bg-brand-50",
  soft: "bg-brand-50 text-brand-800 hover:bg-brand-100",
  ghost: "text-brand-700 hover:bg-brand-50",
  danger: "bg-emergency text-white hover:bg-red-800",
};

export function Button({ variant = "primary", loading, className, children, disabled, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; loading?: boolean }) {
  return (
    <button {...rest} disabled={disabled || loading} aria-busy={loading || undefined} className={clsx(base, variants[variant], className)}>
      {loading && <Loader2 className="size-5 animate-spin" aria-hidden />}
      {children}
    </button>
  );
}

export function LinkButton({ href, variant = "primary", className, children, ...rest }: { href: string; variant?: Variant; className?: string; children: ReactNode } & Omit<React.ComponentProps<typeof Link>, "href" | "className">) {
  return (
    <Link href={href} {...rest} className={clsx(base, variants[variant], className)}>
      {children}
    </Link>
  );
}

export function Card({ className, children, as: Tag = "div", ...rest }: { className?: string; children: ReactNode; as?: "div" | "section" | "article" | "li" } & React.HTMLAttributes<HTMLElement>) {
  return (
    <Tag {...rest} className={clsx("rounded-[1.25rem] border border-line bg-white p-4 shadow-soft sm:p-5", className)}>
      {children}
    </Tag>
  );
}

type Tone = "green" | "amber" | "red" | "gray" | "blue";
const tones: Record<Tone, string> = {
  green: "bg-ok-50 text-ok border-green-200",
  amber: "bg-warn-50 text-warn border-amber-200",
  red: "bg-emergency-50 text-emergency border-red-200",
  gray: "bg-stone-100 text-stone-700 border-stone-200",
  blue: "bg-sky-50 text-sky-800 border-sky-200",
};
export function Badge({ tone = "gray", children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return <span className={clsx("inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold", tones[tone], className)}>{children}</span>;
}

export function Verified({ label = "Verified" }: { label?: string }) {
  return (
    <Badge tone="green">
      <ShieldCheck className="size-3.5" aria-hidden /> {label}
    </Badge>
  );
}

interface FieldProps { label: string; hint?: string; error?: string; required?: boolean }

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & FieldProps>(function Input({ label, hint, error, required, className, ...rest }, ref) {
  const id = useId();
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-semibold">
        {label}
        {required && <span className="text-emergency" aria-hidden> *</span>}
      </label>
      <input ref={ref} id={id} required={required} aria-invalid={!!error} aria-describedby={error ? `${id}-e` : hint ? `${id}-h` : undefined} {...rest}
        className={clsx("min-h-12 w-full rounded-2xl border-2 bg-white px-4 py-2.5 text-base placeholder:text-stone-400 focus:border-brand-600 disabled:bg-stone-100", error ? "border-emergency" : "border-line", className)} />
      {hint && !error && <p id={`${id}-h`} className="text-sm text-muted">{hint}</p>}
      {error && <p id={`${id}-e`} role="alert" className="text-sm font-medium text-emergency">{error}</p>}
    </div>
  );
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement> & FieldProps>(function Select({ label, hint, error, required, className, children, ...rest }, ref) {
  const id = useId();
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-semibold">{label}{required && <span className="text-emergency" aria-hidden> *</span>}</label>
      <select ref={ref} id={id} aria-invalid={!!error} {...rest} className={clsx("min-h-12 w-full rounded-2xl border-2 bg-white px-3 py-2.5 text-base focus:border-brand-600", error ? "border-emergency" : "border-line", className)}>
        {children}
      </select>
      {hint && !error && <p className="text-sm text-muted">{hint}</p>}
      {error && <p role="alert" className="text-sm font-medium text-emergency">{error}</p>}
    </div>
  );
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & FieldProps>(function Textarea({ label, hint, error, required, className, ...rest }, ref) {
  const id = useId();
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-semibold">{label}{required && <span className="text-emergency" aria-hidden> *</span>}</label>
      <textarea ref={ref} id={id} rows={3} aria-invalid={!!error} {...rest} className={clsx("w-full rounded-2xl border-2 bg-white px-4 py-3 text-base focus:border-brand-600", error ? "border-emergency" : "border-line", className)} />
      {hint && !error && <p className="text-sm text-muted">{hint}</p>}
      {error && <p role="alert" className="text-sm font-medium text-emergency">{error}</p>}
    </div>
  );
});

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={clsx("skeleton", className)} />;
}

export function SkeletonList({ rows = 3, height = "h-24" }: { rows?: number; height?: string }) {
  return (
    <div role="status" aria-label="Loading" className="space-y-3">
      {Array.from({ length: rows }).map((_, i) => <Skeleton key={i} className={clsx("w-full", height)} />)}
      <span className="sr-only">Loading…</span>
    </div>
  );
}

export function EmptyState({ title, body, action, icon }: { title: string; body?: string; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-[1.25rem] border-2 border-dashed border-line bg-white/60 px-6 py-10 text-center">
      <div className="text-brand-600" aria-hidden>{icon ?? <Inbox className="size-10" />}</div>
      <h3 className="text-lg font-bold">{title}</h3>
      {body && <p className="max-w-md text-muted">{body}</p>}
      {action}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message?: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-center gap-3 rounded-[1.25rem] border border-red-200 bg-emergency-50 px-6 py-8 text-center">
      <AlertTriangle className="size-9 text-emergency" aria-hidden />
      <p className="font-semibold text-emergency">{message ?? "Something went wrong."}</p>
      {onRetry && <Button variant="secondary" onClick={onRetry}><RefreshCw className="size-4" aria-hidden /> Try again</Button>}
    </div>
  );
}

export function Notice({ tone = "amber", title, children }: { tone?: "amber" | "red" | "green" | "blue"; title?: string; children: ReactNode }) {
  const t = { amber: "border-amber-300 bg-warn-50", red: "border-red-300 bg-emergency-50", green: "border-green-300 bg-ok-50", blue: "border-sky-300 bg-sky-50" }[tone];
  return (
    <div role={tone === "red" ? "alert" : "note"} className={clsx("rounded-2xl border-2 p-4 text-sm", t)}>
      {title && <p className="mb-1 font-bold">{title}</p>}
      <div>{children}</div>
    </div>
  );
}

export function Success({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div role="status" className="flex items-start gap-3 rounded-2xl border-2 border-green-300 bg-ok-50 p-4">
      <CheckCircle2 className="mt-0.5 size-6 shrink-0 text-ok" aria-hidden />
      <div><p className="font-bold">{title}</p>{children && <div className="text-sm text-muted">{children}</div>}</div>
    </div>
  );
}

/** One place that handles loading / error (with retry) / empty / data for every query-driven screen. */
export function QueryBoundary<T>({ query, skeleton, empty, isEmpty, children }: {
  query: UseQueryResult<T>;
  skeleton?: ReactNode;
  empty?: ReactNode;
  isEmpty?: (d: T) => boolean;
  children: (data: T) => ReactNode;
}) {
  if (query.isPending) return <>{skeleton ?? <SkeletonList />}</>;
  if (query.isError) return <ErrorState message={(query.error as Error).message} onRetry={() => query.refetch()} />;
  if (isEmpty?.(query.data) && empty) return <>{empty}</>;
  return <>{children(query.data)}</>;
}

export function PageTitle({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight sm:text-3xl">{title}</h1>
        {subtitle && <p className="mt-1 text-muted">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function Stat({ label, value, tone }: { label: string; value: ReactNode; tone?: "warn" | "ok" | "red" }) {
  return (
    <Card className={clsx(tone === "warn" && "border-amber-300 bg-warn-50", tone === "red" && "border-red-300 bg-emergency-50")}>
      <p className="text-sm font-medium text-muted">{label}</p>
      <p className="mt-1 text-2xl font-extrabold">{value}</p>
    </Card>
  );
}
