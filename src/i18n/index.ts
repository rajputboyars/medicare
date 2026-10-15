/** Hindi-ready i18n. Add keys to en.ts first (source of truth), then translate in hi.ts; missing keys fall back to English. */
import { en } from "./en";
import { hi } from "./hi";
import { DEFAULT_LANG, type Lang } from "./languages";

export { LANGUAGES, LANGUAGE_CODES, DEFAULT_LANG, isLang, type Lang } from "./languages";
export type Key = keyof typeof en;

/** One entry per registered language (TypeScript refuses to compile if a language in languages.ts has no dictionary here). */
const dictionaries: Record<Lang, Partial<Record<Key, string>>> = { en, hi };

export function translate(lang: Lang, key: Key, vars?: Record<string, string | number>): string {
  let s = dictionaries[lang]?.[key] ?? en[key] ?? key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replace(`{${k}}`, String(v));
  return s;
}

export { DEFAULT_LANG as defaultLang };
