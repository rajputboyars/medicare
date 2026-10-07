import { buildSeed, DEFAULT_SETTINGS, type Db } from "./seed";
import type { PlatformSettings, Role } from "@/lib/types";

/**
 * Data access for V1. `db()` returns the in-process working set. With DATA_SOURCE=mongo the working set is loaded from
 * MongoDB at server start (src/instrumentation.ts) and every mutating request is written back (src/server/persistence.ts).
 * Business rules live in src/server/services/* and only touch data through `db()`, so a repository layer can replace this later.
 */
const g = globalThis as unknown as { __mcDb?: Db };

export function db(): Db {
  return (g.__mcDb ??= buildSeed());
}

export function setDb(d: Db) {
  g.__mcDb = d;
}

/** Test helper – resets the store to a fresh seed. */
export function resetDb(): Db {
  g.__mcDb = buildSeed();
  return g.__mcDb;
}

export function settings(): PlatformSettings {
  const d = db();
  if (!d.settings.length) d.settings.push({ ...DEFAULT_SETTINGS });
  return d.settings[0];
}

let counter = 1000;
export function uid(prefix: string): string {
  counter += 1;
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36)}${Math.random().toString(36).slice(2, 5)}`;
}

export function otp(): string {
  return String(Math.floor(1000 + Math.random() * 9000));
}

export function orderCode(): string {
  const taken = new Set(db().orders.map((o) => o.code));
  for (;;) {
    const c = `MC-${Math.floor(10000 + Math.random() * 89999)}`;
    if (!taken.has(c)) return c;
  }
}

/** Audit log for sensitive actions (prescription review, order decisions, verification, settings). */
export function audit(actor: { id: string; role: Role }, action: string, targetType: string, targetId: string, meta?: Record<string, unknown>) {
  const d = db();
  d.audit.unshift({ id: uid("aud"), actorId: actor.id, actorRole: actor.role, action, targetType, targetId, meta, at: new Date().toISOString() });
  if (d.audit.length > 2000) d.audit.length = 2000;
}
