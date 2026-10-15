/**
 * Search text normalisation, shared by the server (indexing + matching) and the screens (highlighting, recent searches).
 *
 *   "Telma-40", "TELMA 40", "telma40", "  Telma   40 mg "  →  all reduce to the same tokens ["telma", "40"] / compact "telma40"
 *
 * Rules: lower-case, punctuation and hyphens become spaces, letters and digits that touch are separated ("telma40" → "telma 40"),
 * repeated spaces collapse. This is deliberately simple: it is cheap, predictable and easy to move into a dedicated search engine
 * (Atlas Search / Elasticsearch / Typesense) later, where these same normalised fields become the indexed fields.
 */
export function normalizeText(input: string | undefined | null): string {
  if (!input) return "";
  return input
    .normalize("NFKD").replace(/[̀-ͯ]/g, "") // é → e
    .toLowerCase()
    .replace(/([a-z])(\d)/g, "$1 $2")
    .replace(/(\d)([a-z])/g, "$1 $2")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Same text with no spaces at all: "telma 40 mg" → "telma40mg". Lets "telma40" match "Telma 40 mg". */
export const compactText = (input: string | undefined | null) => normalizeText(input).replace(/ /g, "");

export const tokenize = (input: string | undefined | null) => normalizeText(input).split(" ").filter(Boolean);

/** Units and filler words that carry no identity of their own */
const FILLER = new Set(["mg", "mcg", "ml", "gm", "g", "iu", "tab", "tablet", "tablets", "cap", "capsule", "capsules", "syrup", "strip", "of", "the"]);
export const meaningfulTokens = (input: string | undefined | null) => tokenize(input).filter((t) => !FILLER.has(t));

/** Edit distance with an early exit: returns max+1 as soon as it is certain the words are further apart than `max`. */
export function editDistance(a: string, b: string, max = 2): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      cur.push(v);
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

/** How many typos we forgive for a word of this length. Short words and numbers must match exactly. */
export const typoBudget = (word: string) => (/\d/.test(word) || word.length < 4 ? 0 : word.length < 8 ? 1 : 2);

export type TokenMatch = "EXACT" | "PREFIX" | "FUZZY" | null;

/** Does the query word match this indexed word? exact > prefix (as-you-type) > a small typo. */
export function matchToken(query: string, candidate: string): TokenMatch {
  if (query === candidate) return "EXACT";
  if (query.length >= 2 && candidate.startsWith(query)) return "PREFIX";
  const budget = typoBudget(query);
  if (budget && editDistance(query, candidate, budget) <= budget) return "FUZZY";
  // a typo in a longer word, matched against the start of the candidate ("telmisarten" vs "telmisartan 40")
  if (budget && query.length >= 6 && editDistance(query, candidate.slice(0, query.length), budget) <= budget) return "FUZZY";
  return null;
}
