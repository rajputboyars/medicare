import clsx from "clsx";

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={clsx("skeleton", className)} />;
}

/** Placeholder with the same silhouette as a real card, so content does not jump when it arrives. */
export function SkeletonCard({ lines = 3, media = false, className }: { lines?: number; media?: boolean; className?: string }) {
  return (
    <div aria-hidden className={clsx("flex gap-3 rounded-card border border-line bg-surface p-4", className)}>
      {media && <Skeleton className="size-14 shrink-0 rounded-control" />}
      <div className="flex-1 space-y-2.5">
        <Skeleton className="h-4 w-2/5" />
        {Array.from({ length: lines - 1 }).map((_, i) => <Skeleton key={i} className={clsx("h-3.5", i % 2 ? "w-3/5" : "w-4/5")} />)}
      </div>
    </div>
  );
}

export function SkeletonMetric() {
  return (
    <div aria-hidden className="rounded-card border border-line bg-surface p-4">
      <Skeleton className="h-3.5 w-1/2" />
      <Skeleton className="mt-3 h-7 w-1/3" />
      <Skeleton className="mt-2 h-3 w-2/3" />
    </div>
  );
}

/** Announced once to screen readers; the individual placeholders are hidden. */
export function SkeletonList({ rows = 3, media = false, lines = 3 }: { rows?: number; media?: boolean; lines?: number; height?: string }) {
  return (
    <div role="status" aria-label="Loading" className="space-y-3">
      {Array.from({ length: rows }).map((_, i) => <SkeletonCard key={i} media={media} lines={lines} />)}
      <span className="sr-only">Loading…</span>
    </div>
  );
}
