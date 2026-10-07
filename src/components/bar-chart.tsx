/** Dependency-free bar chart (CSS only, theme-aware, readable by screen readers through the data list). */
export function BarChart({ data, format = (n: number) => String(n), label }: { data: { label: string; value: number }[]; format?: (n: number) => string; label: string }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <figure aria-label={label}>
      <div className="flex h-44 items-end gap-2 border-b border-line px-1" role="img" aria-label={`${label}: ${data.map((d) => `${d.label} ${format(d.value)}`).join(", ")}`}>
        {data.map((d) => (
          <div key={d.label} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1">
            <span className="text-[0.7rem] font-semibold tabular-nums text-muted">{d.value > 0 ? format(d.value) : ""}</span>
            <div className="w-full max-w-10 rounded-t-lg bg-brand-600" style={{ height: `${Math.max(d.value > 0 ? 4 : 1, (d.value / max) * 78)}%` }} />
          </div>
        ))}
      </div>
      <div className="mt-1 flex gap-2 px-1">{data.map((d) => <span key={d.label} className="min-w-0 flex-1 text-center text-xs text-muted">{d.label}</span>)}</div>
    </figure>
  );
}
