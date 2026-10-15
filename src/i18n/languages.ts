/**
 * The languages the app can speak. This is the ONE place to register a new one:
 *   1. add an entry here  2. add src/i18n/<code>.ts (copy hi.ts; missing keys fall back to English)  3. add it to `dictionaries` in index.ts
 * Accounts, the language picker, validation and the API all read this list, so nothing else changes.
 */
export const LANGUAGES = [
  { code: "en", name: "English", native: "English" },
  { code: "hi", name: "Hindi", native: "हिन्दी" },
  // { code: "mr", name: "Marathi", native: "मराठी" },
] as const;

export type Lang = (typeof LANGUAGES)[number]["code"];
export const LANGUAGE_CODES = LANGUAGES.map((l) => l.code) as unknown as readonly [Lang, ...Lang[]];
export const isLang = (v: unknown): v is Lang => typeof v === "string" && (LANGUAGE_CODES as readonly string[]).includes(v);
export const DEFAULT_LANG: Lang = "en";
