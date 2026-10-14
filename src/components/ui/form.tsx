"use client";
import clsx from "clsx";
import { AlertCircle } from "lucide-react";
import { forwardRef, useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";

interface FieldProps { label: string; hint?: string; error?: string; required?: boolean }

const control = "w-full rounded-control border-2 bg-surface px-4 text-base placeholder:text-subtle disabled:bg-surface-2 disabled:text-muted focus:border-brand-600";

function Field({ id, label, hint, error, required, children }: { id: string; label: string; hint?: string; error?: string; required?: boolean; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="t-label block">
        {label}
        {required ? <span className="text-emergency" aria-hidden> *</span> : null}
        {required ? <span className="sr-only"> (required)</span> : null}
      </label>
      {children}
      {hint && !error && <p id={`${id}-h`} className="t-caption">{hint}</p>}
      {error && <p id={`${id}-e`} role="alert" className="flex items-start gap-1.5 text-sm font-semibold text-emergency"><AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />{error}</p>}
    </div>
  );
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & FieldProps>(function Input({ label, hint, error, required, className, ...rest }, ref) {
  const id = useId();
  return (
    <Field id={id} label={label} hint={hint} error={error} required={required}>
      <input ref={ref} id={id} required={required} aria-invalid={!!error} aria-describedby={error ? `${id}-e` : hint ? `${id}-h` : undefined} {...rest}
        className={clsx(control, "min-h-12 py-2.5", error ? "border-emergency" : "border-line-strong", className)} />
    </Field>
  );
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement> & FieldProps>(function Select({ label, hint, error, required, className, children, ...rest }, ref) {
  const id = useId();
  return (
    <Field id={id} label={label} hint={hint} error={error} required={required}>
      <select ref={ref} id={id} aria-invalid={!!error} aria-describedby={error ? `${id}-e` : hint ? `${id}-h` : undefined} {...rest}
        className={clsx(control, "min-h-12 py-2.5", error ? "border-emergency" : "border-line-strong", className)}>
        {children}
      </select>
    </Field>
  );
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & FieldProps>(function Textarea({ label, hint, error, required, className, ...rest }, ref) {
  const id = useId();
  return (
    <Field id={id} label={label} hint={hint} error={error} required={required}>
      <textarea ref={ref} id={id} rows={3} aria-invalid={!!error} aria-describedby={error ? `${id}-e` : hint ? `${id}-h` : undefined} {...rest}
        className={clsx(control, "py-3", error ? "border-emergency" : "border-line-strong", className)} />
    </Field>
  );
});

/** Large, labelled switch/checkbox row. `role="switch"` for on/off settings. */
export function Toggle({ label, hint, checked, onChange, disabled }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className={clsx("flex min-h-14 cursor-pointer items-center justify-between gap-4", disabled && "opacity-50")}>
      <span><span className="t-body block font-semibold">{label}</span>{hint && <span className="t-caption block">{hint}</span>}</span>
      <input type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} className="size-7 shrink-0 accent-brand-600" />
    </label>
  );
}
