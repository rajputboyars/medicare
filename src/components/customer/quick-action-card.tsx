import Link from "next/link";
import clsx from "clsx";
import type { LucideIcon } from "lucide-react";

/** One of the four big Home actions. Icon + short title + one-line hint; `primary` is the main one (Order Medicine). */
export function QuickActionCard({ href, icon: Icon, title, hint, primary }: { href: string; icon: LucideIcon; title: string; hint: string; primary?: boolean }) {
  return (
    <Link href={href} className={clsx("group flex min-h-[8.25rem] flex-col justify-between rounded-card border p-4 shadow-soft transition-shadow hover:shadow-raised",
      primary ? "border-brand-600 bg-brand-600 text-white" : "border-line bg-surface")}>
      <span className={clsx("grid size-11 place-items-center rounded-control", primary ? "bg-white/15" : "bg-brand-50 text-brand-700")}><Icon className="size-6" aria-hidden /></span>
      <span>
        <span className="t-card block leading-tight">{title}</span>
        <span className={clsx("t-caption mt-0.5 block", primary && "!text-brand-100")}>{hint}</span>
      </span>
    </Link>
  );
}
