import type { LucideIcon } from "lucide-react";

/** One navigation entry. Used by the customer bottom bar, the desktop sidebar, and the pharmacy / admin / rider navigation. */
export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Match only this exact path (e.g. dashboards at the section root) */
  exact?: boolean;
  /** Extra paths that should highlight this item */
  also?: string[];
  /** Small count shown next to the label (e.g. orders waiting) */
  badge?: number;
}

export const isActive = (item: NavItem, path: string) =>
  item.exact ? path === item.href : path === item.href || path.startsWith(`${item.href}/`) || !!item.also?.some((p) => path === p || path.startsWith(`${p}/`));
