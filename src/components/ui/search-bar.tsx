"use client";
import clsx from "clsx";
import { Search, X } from "lucide-react";
import { useId, type FormEvent } from "react";

/** The one search field used on Home and Medicines. Large, labelled, clearable, keyboard friendly. */
export function SearchBar({ value, onChange, onSubmit, placeholder, label = "Search", submitLabel, autoFocus, className }: {
  value: string; onChange: (v: string) => void; onSubmit?: () => void; placeholder: string; label?: string; submitLabel?: string; autoFocus?: boolean; className?: string;
}) {
  const id = useId();
  function submit(e: FormEvent) { e.preventDefault(); onSubmit?.(); }
  return (
    <form role="search" onSubmit={submit} className={clsx("flex gap-2", className)}>
      <div className="relative min-w-0 flex-1">
        <label htmlFor={id} className="sr-only">{label}</label>
        <Search className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-muted" aria-hidden />
        <input
          id={id} type="search" enterKeyHint="search" autoComplete="off" autoFocus={autoFocus} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
          className="min-h-14 w-full rounded-control border-2 border-line-strong bg-surface pl-12 pr-12 text-base placeholder:text-subtle focus:border-brand-600 [&::-webkit-search-cancel-button]:hidden"
        />
        {value && (
          <button type="button" onClick={() => onChange("")} aria-label="Clear search" className="absolute right-1.5 top-1/2 grid size-11 -translate-y-1/2 place-items-center rounded-control text-muted hover:bg-surface-2">
            <X className="size-5" aria-hidden />
          </button>
        )}
      </div>
      {submitLabel && <button type="submit" className="min-h-14 shrink-0 rounded-control bg-brand-600 px-5 font-semibold text-white hover:bg-brand-700">{submitLabel}</button>}
    </form>
  );
}
