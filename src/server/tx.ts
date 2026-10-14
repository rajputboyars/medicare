import { db } from "./store";
import type { Db } from "./seed";

type Collections = Exclude<keyof Db, "files" | "settings">;
type Row = Record<string, unknown> & { id: string };

/**
 * All-or-nothing unit of work over the in-process working set.
 *
 * `fn` runs synchronously (so no other request can interleave in this Node process). If it throws, every listed
 * collection is put back exactly as it was before `fn` started: rows created meanwhile disappear, edited rows get their
 * old values back, and deleted rows return. Rows that existed before keep their object identity, so references held by
 * the caller stay valid. Pass only the collections the work may touch.
 *
 * Persistence is a second, separate guarantee: the HTTP layer flushes the finished request to MongoDB in one write-back
 * (see persistence.ts). When the services move to async repositories this helper becomes a real MongoDB session
 * (`session.withTransaction`) with the same call shape.
 */
export function atomically<T>(collections: readonly Collections[], fn: () => T): T {
  const d = db();
  const before = collections.map((c) => [c, structuredClone(d[c]) as unknown as Row[]] as const);
  try {
    return fn();
  } catch (e) {
    for (const [c, snapshot] of before) {
      const live = d[c] as unknown as Row[];
      const byId = new Map(live.map((r) => [r.id, r]));
      const restored = snapshot.map((s) => {
        const row = byId.get(s.id);
        if (!row) return s;
        for (const k of Object.keys(row)) delete row[k];
        return Object.assign(row, s);
      });
      live.length = 0;
      live.push(...restored);
    }
    throw e;
  }
}
