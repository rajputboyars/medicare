/** Hindi-ready i18n. Add keys to en.ts first (source of truth), then translate in hi.ts; missing keys fall back to English. */
import { en } from "./en";
import { hi } from "./hi";

export type Lang = "en" | "hi";
export type Key = keyof typeof en;

const dict: Record<Lang, Partial<Record<Key, string>>> = { en, hi };

export function translate(lang: Lang, key: Key, vars?: Record<string, string | number>): string {
  let s = dict[lang][key] ?? en[key] ?? key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replace(`{${k}}`, String(v));
  return s;
}
