"use client";
import Link from "next/link";
import clsx from "clsx";
import { Loader2 } from "lucide-react";
import type { ButtonHTMLAttributes, ComponentProps, ReactNode } from "react";

export type ButtonVariant = "primary" | "secondary" | "soft" | "ghost" | "danger" | "danger-outline";
export type ButtonSize = "md" | "lg" | "sm";

const base = "inline-flex items-center justify-center gap-2 rounded-control font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 aria-busy:cursor-progress";
const sizes: Record<ButtonSize, string> = {
  md: "min-h-12 px-5 py-2.5 text-base",   // 51px: default, comfortable for thumbs
  lg: "min-h-14 px-6 py-3 text-lg",       // primary calls to action
  sm: "min-h-10 px-3.5 py-2 text-sm",     // dense dashboards only; still above 40px
};
const variants: Record<ButtonVariant, string> = {
  primary: "bg-brand-600 text-white hover:bg-brand-700 active:bg-brand-800",
  secondary: "border-2 border-brand-600 bg-surface text-brand-700 hover:bg-brand-50",
  soft: "bg-brand-50 text-brand-800 hover:bg-brand-100",
  ghost: "text-brand-700 hover:bg-brand-50",
  danger: "bg-emergency text-white hover:bg-red-800",
  "danger-outline": "border-2 border-emergency bg-surface text-emergency hover:bg-emergency-50",
};

export const buttonClass = (variant: ButtonVariant = "primary", size: ButtonSize = "md", className?: string) => clsx(base, sizes[size], variants[variant], className);

export function Button({ variant = "primary", size = "md", loading, className, children, disabled, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: ButtonSize; loading?: boolean }) {
  return (
    <button {...rest} disabled={disabled || loading} aria-busy={loading || undefined} className={buttonClass(variant, size, className)}>
      {loading && <Loader2 className="size-5 animate-spin" aria-hidden />}
      {children}
    </button>
  );
}

export function LinkButton({ href, variant = "primary", size = "md", className, children, ...rest }: { href: string; variant?: ButtonVariant; size?: ButtonSize; className?: string; children: ReactNode } & Omit<ComponentProps<typeof Link>, "href" | "className">) {
  return <Link href={href} {...rest} className={buttonClass(variant, size, className)}>{children}</Link>;
}

/** Icon-only button. `label` is required: it becomes the accessible name. */
export function IconButton({ label, children, className, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button type="button" aria-label={label} title={label} {...rest} className={clsx("tap inline-grid place-items-center rounded-control text-ink hover:bg-surface-2 disabled:opacity-50", className)}>
      {children}
    </button>
  );
}
