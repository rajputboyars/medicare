import { createHash } from "node:crypto";
import { ApiError, badRequest } from "./errors";
import { db, uid } from "./store";

/**
 * Idempotency: doing the same thing twice must have the same effect as doing it once.
 *
 * A slow network or a double tap makes the browser send the same request again. If the request carries an Idempotency-Key,
 * the first outcome is remembered under (scope, key, user) and the repeat gets the SAME answer, with no second order, charge,
 * refund or delivery. The same key with different content is refused, because that is a bug in the caller, not a retry.
 */
const KEY_RE = /^[A-Za-z0-9_.:-]{8,80}$/;
export const IDEMPOTENCY_TTL_MS = 24 * 3600_000;

export const fingerprint = (x: unknown): string => createHash("sha256").update(JSON.stringify(x, (_k, v) => (v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v))).digest("hex");

/** Reads and validates the Idempotency-Key header. Missing is allowed (the caller decides if it is required). */
export function idempotencyKeyFrom(req: Request): string | undefined {
  const k = req.headers.get("idempotency-key");
  if (k === null) return undefined;
  if (!KEY_RE.test(k)) throw badRequest("The Idempotency-Key must be 8 to 80 letters, digits or - _ . :");
  return k;
}

export interface Once<T> { value: T; replayed: boolean }

/**
 * Runs `fn` at most once per (scope, key, user). `fn` returns plain JSON (usually ids), which is stored and replayed.
 * With no key it simply runs. A throwing `fn` stores nothing, so a failed attempt can be retried with the same key.
 */
export function once<T>(scope: string, key: string | undefined, userId: string | undefined, fp: unknown, fn: () => T, status = 200): Once<T> {
  if (!key) return { value: fn(), replayed: false };
  const d = db();
  const f = fingerprint(fp);
  const hit = d.idempotencyRecords.find((r) => r.scope === scope && r.key === key && r.userId === userId);
  if (hit) {
    if (hit.fingerprint !== f) throw new ApiError(422, "This Idempotency-Key was already used for a different request.", undefined, "IDEMPOTENCY_KEY_REUSED");
    return { value: hit.response as T, replayed: true };
  }
  const value = fn();
  d.idempotencyRecords.push({ id: uid("idem"), scope, key, userId, fingerprint: f, status, response: value, createdAt: new Date().toISOString() });
  return { value, replayed: false };
}

/** Has this (scope, key) been recorded? Used by webhooks, where the "key" is the gateway's event id. */
export const seen = (scope: string, key: string) => db().idempotencyRecords.some((r) => r.scope === scope && r.key === key);
export function record(scope: string, key: string, response: unknown = { ok: true }) {
  db().idempotencyRecords.push({ id: uid("idem"), scope, key, fingerprint: "-", status: 200, response, createdAt: new Date().toISOString() });
}

export function purgeIdempotency(at = Date.now()): number {
  const d = db();
  const before = d.idempotencyRecords.length;
  d.idempotencyRecords = d.idempotencyRecords.filter((r) => at - Date.parse(r.createdAt) < IDEMPOTENCY_TTL_MS);
  return before - d.idempotencyRecords.length;
}
