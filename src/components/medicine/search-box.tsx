"use client";
import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { History, Search, X } from "lucide-react";
import clsx from "clsx";
import { api } from "@/lib/api";
import { useRecentSearches } from "@/lib/search-history";
import { trackEvent } from "@/lib/analytics-client";

interface Suggestion { medicineId: string; name: string; strength: string; generic: string; brand: string }

function useDebounced<T>(v: T, ms: number) {
  const [d, setD] = useState(v);
  useEffect(() => { const id = setTimeout(() => setD(v), ms); return () => clearTimeout(id); }, [v, ms]);
  return d;
}

/**
 * Search field with suggestions. As you type, a few matching medicines appear (requests are debounced ~250 ms); when the
 * box is empty and focused, recent searches appear with a "Clear" button. Full keyboard support (arrows, Enter, Esc).
 */
export function SearchBox({ value, onChange, onSubmit, autoFocus }: { value: string; onChange: (v: string) => void; onSubmit: (v: string) => void; autoFocus?: boolean }) {
  const router = useRouter();
  const id = useId();
  const box = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const recent = useRecentSearches();
  const q = useDebounced(value.trim(), 250);

  const sug = useQuery({
    queryKey: ["suggest", q], enabled: open && q.length >= 2, staleTime: 60_000, placeholderData: (p) => p,
    queryFn: () => api<Suggestion[]>(`/api/medicines/suggestions?q=${encodeURIComponent(q)}&limit=6`),
  });
  const showRecent = open && value.trim().length < 2 && recent.items.length > 0;
  const options: { key: string; label: string; sub?: string; run: () => void; icon: "search" | "recent" }[] = showRecent
    ? recent.items.map((t) => ({ key: `r-${t}`, label: t, icon: "recent" as const, run: () => { onChange(t); onSubmit(t); setOpen(false); } }))
    : (open && q.length >= 2 ? (sug.data ?? []) : []).map((s) => ({
        key: s.medicineId, label: s.name, sub: `${s.generic} · ${s.strength}`, icon: "search" as const,
        run: () => { trackEvent("medicine_selected", { medicine: s.medicineId, from: "suggestion" }); recent.remember(s.name); setOpen(false); router.push(`/medicines/${s.medicineId}`); },
      }));

  useEffect(() => { setActive(-1); }, [value, open]);
  useEffect(() => {
    const away = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, []);

  function onKey(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setActive((a) => Math.min(options.length - 1, a + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(-1, a - 1)); }
    else if (e.key === "Escape") setOpen(false);
    else if (e.key === "Enter") { e.preventDefault(); if (active >= 0 && options[active]) options[active].run(); else { onSubmit(value.trim()); setOpen(false); } }
  }

  return (
    <div ref={box} className="relative">
      <div className="flex items-center gap-2 rounded-control border-2 border-line-strong bg-surface px-3 focus-within:border-brand-600">
        <Search className="size-5 shrink-0 text-subtle" aria-hidden />
        <input
          role="combobox" aria-expanded={open && options.length > 0} aria-controls={`${id}-list`} aria-autocomplete="list" aria-activedescendant={active >= 0 ? `${id}-o${active}` : undefined}
          aria-label="Search medicines" autoFocus={autoFocus} autoComplete="off" enterKeyHint="search" value={value} placeholder="Medicine name, brand or generic"
          onFocus={() => setOpen(true)} onChange={(e) => { onChange(e.target.value); setOpen(true); }} onKeyDown={onKey}
          className="min-h-12 w-full bg-transparent text-base outline-none placeholder:text-subtle"
        />
        {value && <button type="button" aria-label="Clear search" onClick={() => { onChange(""); onSubmit(""); }} className="tap grid place-items-center rounded-control text-muted"><X className="size-5" aria-hidden /></button>}
      </div>

      {open && options.length > 0 && (
        <div className="absolute inset-x-0 top-full z-30 mt-1 overflow-hidden rounded-card border border-line bg-surface shadow-overlay">
          {showRecent && (
            <div className="flex items-center justify-between border-b border-line px-3 py-2">
              <p className="t-caption">Recent searches</p>
              <button type="button" onClick={() => void recent.clear()} className="text-sm font-bold text-brand-700 underline">Clear</button>
            </div>
          )}
          <ul id={`${id}-list`} role="listbox" aria-label={showRecent ? "Recent searches" : "Suggestions"}>
            {options.map((o, i) => (
              <li key={o.key} id={`${id}-o${i}`} role="option" aria-selected={i === active}>
                <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={o.run}
                  className={clsx("flex min-h-12 w-full items-center gap-3 px-3 py-2 text-left", i === active ? "bg-brand-50" : "hover:bg-surface-2")}>
                  {o.icon === "recent" ? <History className="size-4 shrink-0 text-subtle" aria-hidden /> : <Search className="size-4 shrink-0 text-subtle" aria-hidden />}
                  <span className="min-w-0"><span className="block truncate font-semibold">{o.label}</span>{o.sub && <span className="t-caption block truncate">{o.sub}</span>}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
