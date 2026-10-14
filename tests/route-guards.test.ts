import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Structural safety net: no API route can be added without a guard. Every route file must either call a guard
 * (requireUser / requireRole / currentUser) or be on the short, reviewed list of public routes below.
 */
const API = path.resolve(import.meta.dirname, "../src/app/api");

const PUBLIC: Record<string, string> = {
  "auth/login": "credentials are the guard; rate limited",
  "auth/logout": "clears the cookie",
  "auth/register": "creates a CUSTOMER only; rate limited; strict body",
  "auth/me": "answers null when signed out",
  "coverage": "is my pincode live?",
  "launch-signup": "leave a number for a coming-soon area; rate limited",
  "medicines/meta": "catalogue facets",
  "medicines/search": "public catalogue search",
  "medicines/[id]": "master product data",
  "medicines/[id]/availability": "pharmacy-specific stock and price for a pincode",
  "offers": "public offers",
  "pharmacies/nearby": "public pharmacy list (verified only)",
  "partners/pharmacy": "partner application form; rate limited",
  "partners/rider": "partner application form; rate limited",
  "quick-order": "guests can ask for a call-back; rate limited",
  "medicine-requests": "guests can ask 'find my medicine'; GET needs sign-in",
};

function routes(dir = API, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) routes(p, out);
    else if (e.name === "route.ts") out.push(p);
  }
  return out;
}

describe("every API route is guarded", () => {
  const files = routes();
  it("finds the routes", () => expect(files.length).toBeGreaterThan(60));

  for (const file of files) {
    const rel = path.relative(API, path.dirname(file)).split(path.sep).join("/");
    it(`/api/${rel}`, () => {
      const src = fs.readFileSync(file, "utf8");
      const guarded = /\b(requireUser|requireRole|currentUser)\(/.test(src);
      if (rel in PUBLIC) return; // reviewed as public
      expect(guarded, `/api/${rel} has no auth guard and is not on the public list`).toBe(true);
    });
  }

  it("mutating routes are wrapped in handle() so errors, envelopes and persistence are consistent", () => {
    for (const file of files) {
      const src = fs.readFileSync(file, "utf8");
      const rel = path.relative(API, file);
      if (rel.includes("logout") || rel.includes("files")) continue; // special responses
      for (const m of src.matchAll(/export const (GET|POST|PUT|PATCH|DELETE) = (\w+)/g)) expect(m[2], `${rel} ${m[1]}`).toBe("handle");
    }
  });

  it("nothing outside the allowlist is public, and the allowlist has no stale entries", () => {
    const rels = new Set(files.map((f) => path.relative(API, path.dirname(f)).split(path.sep).join("/")));
    for (const k of Object.keys(PUBLIC)) expect(rels.has(k), `${k} is listed as public but does not exist`).toBe(true);
  });
});
