import { compactText, matchToken, meaningfulTokens, normalizeText, tokenize, type TokenMatch } from "@/lib/search-normalize";
import type { Medicine } from "@/lib/types";
import { db } from "@/server/store";

/**
 * The matching and ranking behind search and autocomplete. Pure functions over the normalised medicine fields.
 *
 * V1 scans the active catalogue in memory (fast for thousands of products). To move to a dedicated engine, index
 * {normalizedName, normalizedGenericName, brand, searchAliases, searchKeywords} and keep this file as the reference
 * for ranking expectations (the tests describe them).
 *
 * Score, highest first:
 *   100  the whole query equals a name / alias / "name + strength"         ("telma 40", "telma40")
 *    85  name or alias STARTS with the query
 *    70  the compact query sits inside the compact name                    ("telma40" in "telma40mg")
 * (each multiplied by how trustworthy the field is: name 1, alias .95, brand .85, generic .8, keyword .4)
 *    20+ every query word matches a word in the searchable text (exact 10, prefix 7, small typo 4 each)
 * A medicine is a result only if EVERY meaningful query word matches something, so extra words narrow the search.
 */
const WEIGHT = { name: 1, alias: 0.95, brand: 0.85, generic: 0.8, keyword: 0.4 } as const;

export interface Ranked { medicine: Medicine; score: number; quality: "EXACT" | "PREFIX" | "WORDS" | "FUZZY" }

interface Doc { medicine: Medicine; fields: { kind: keyof typeof WEIGHT; text: string; compact: string; tokens: string[] }[] }

const docCache = new WeakMap<Medicine, { stamp: string; doc: Doc }>();
function docOf(m: Medicine): Doc {
  const stamp = m.updatedAt + m.normalizedName; // rebuilt whenever the medicine changes
  const hit = docCache.get(m);
  if (hit && hit.stamp === stamp) return hit.doc;
  const field = (kind: keyof typeof WEIGHT, raw: string) => ({ kind, text: normalizeText(raw), compact: compactText(raw), tokens: tokenize(raw) });
  const fields = [
    field("name", `${m.name}`), field("name", `${m.name} ${m.strength}`),
    ...m.searchAliases.map((a) => field("alias", a)),
    field("brand", `${m.brand} ${m.strength}`), field("brand", m.brand),
    field("generic", `${m.genericName} ${m.strength}`), field("generic", m.genericName),
    ...m.searchKeywords.map((k) => field("keyword", k)),
    field("keyword", `${m.dosageForm} ${m.packSize}`), field("keyword", m.manufacturer), // "tablet", "syrup", "glenmark"
  ].filter((f) => f.text);
  const doc = { medicine: m, fields };
  docCache.set(m, { stamp, doc });
  return doc;
}

export function scoreMedicine(m: Medicine, q: { text: string; compact: string; words: string[] }): Ranked | null {
  if (!q.words.length) return null;
  const { fields } = docOf(m);
  let best = 0;
  let quality: Ranked["quality"] = "WORDS";

  for (const f of fields) {
    const w = WEIGHT[f.kind];
    if (f.text === q.text || f.compact === q.compact) { if (100 * w > best) { best = 100 * w; quality = "EXACT"; } }
    else if (f.text.startsWith(q.text) || f.compact.startsWith(q.compact)) { if (85 * w > best) { best = 85 * w; quality = "PREFIX"; } }
    else if (q.compact.length >= 4 && f.compact.includes(q.compact)) { if (70 * w > best) { best = 70 * w; quality = "PREFIX"; } }
  }
  if (best) return { medicine: m, score: best, quality };

  // Every word must match some word somewhere in the medicine's searchable text
  const all = fields.flatMap((f) => f.tokens.map((t) => ({ t, w: WEIGHT[f.kind] })));
  let total = 0;
  let fuzzy = false;
  for (const word of q.words) {
    let bestWord = 0;
    for (const c of all) {
      const how: TokenMatch = matchToken(word, c.t);
      if (!how) continue;
      const base = how === "EXACT" ? 10 : how === "PREFIX" ? 7 : 4;
      if (base * c.w > bestWord) { bestWord = base * c.w; fuzzy = how === "FUZZY" ? true : fuzzy && how !== "EXACT"; }
    }
    if (!bestWord) return null;
    total += bestWord;
  }
  return { medicine: m, score: 20 + total, quality: fuzzy ? "FUZZY" : "WORDS" };
}

export function parseQuery(raw: string | undefined) {
  const text = normalizeText(raw);
  return { text, compact: compactText(raw), words: meaningfulTokens(raw).length ? meaningfulTokens(raw) : tokenize(raw) };
}

/** Active medicines that match, best first. Empty query returns [] (callers decide what "no query" means). */
export function rankMedicines(raw: string | undefined, filter: (m: Medicine) => boolean = () => true): Ranked[] {
  const q = parseQuery(raw);
  if (!q.words.length) return [];
  const out: Ranked[] = [];
  for (const m of db().medicines) {
    if (m.status !== "ACTIVE" || !filter(m)) continue;
    const r = scoreMedicine(m, q);
    if (r) out.push(r);
  }
  return out.sort((a, b) => b.score - a.score || a.medicine.name.localeCompare(b.medicine.name));
}
