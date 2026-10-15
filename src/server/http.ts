import { headers } from "next/headers";
import { ZodError, type ZodType } from "zod";
import { rateLimiter } from "@/lib/rate-limit";
import { ApiError, badRequest, conflict, forbidden, notFound } from "./errors";
import { flush, persistenceActive } from "./persistence";
import { failure, success } from "./core/response";

/**
 * The single entry point for API handlers. Routes import everything from here:
 *   guards       currentUser, requireUser(permission), requireRole(...roles), assertOwner, assertPharmacy   (core/guards)
 *   validation   parseBody(req, schema), parseQuery(url, schema), validate(schema, data)
 *   responses    handle(fn): standard envelope + error mapping + write-back to MongoDB                      (core/response)
 *   pagination   paginate(rows, url, options)                                                                (core/pagination)
 *   rate limits  limit(bucket, max, windowMs, key?)
 */
export { ApiError, badRequest, forbidden, notFound, conflict };
export { currentUser, requireUser, requireRole, requireElevated, requireApplicant, assertOwner, assertPharmacy } from "./core/guards";
export { paginate } from "./core/pagination";
export { Paged, WithMessage } from "./core/response";

/**
 * CSRF defence for cookie-authenticated requests, in three layers:
 *  1. the session cookie is SameSite=Lax, so browsers do not attach it to cross-site POSTs
 *  2. every state-changing request must come from our own origin: if the browser sends an Origin header it must match this host
 *     (or an entry in ALLOWED_ORIGINS). Requests without Origin (server-to-server, tests) carry no browser cookies to abuse.
 *  3. bodies are JSON or multipart behind that check, never accepted as a plain HTML form post without an Origin
 */
export function assertSameOrigin(req: Request) {
  const origin = req.headers.get("origin");
  if (!origin) return;
  let host: string;
  try { host = new URL(origin).host; } catch { throw new ApiError(403, "This request was blocked.", undefined, "CSRF_BLOCKED"); }
  const own = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? new URL(req.url).host;
  const allowed = (process.env.ALLOWED_ORIGINS ?? "").split(",").map((o) => o.trim()).filter(Boolean).map((o) => { try { return new URL(o).host; } catch { return o; } });
  if (host !== own && !allowed.includes(host)) throw new ApiError(403, "This request was blocked.", undefined, "CSRF_BLOCKED");
}

/** Where the request came from, for sessions and OTP throttling. Never used for anything but security. */
export async function requestMeta(req?: Request): Promise<{ ip: string; userAgent?: string }> {
  return { ip: await clientKey(), userAgent: req?.headers.get("user-agent") ?? undefined };
}

export async function clientKey(): Promise<string> {
  const h = await headers();
  return (h.get("x-forwarded-for")?.split(",")[0] ?? h.get("x-real-ip") ?? "local").trim();
}

/** Rate-limit gate. `extra` scopes the bucket to something other than the caller's IP (e.g. user + order). */
export async function limit(bucket: string, max: number, windowMs: number, extra = "") {
  const key = `${bucket}:${extra || (await clientKey())}`;
  const r = rateLimiter.hit(key, max, windowMs);
  if (!r.allowed) throw new ApiError(429, `Too many attempts. Please try again in ${r.retryAfterSec} seconds.`);
}

export async function parseBody<T>(req: Request, schema: ZodType<T>): Promise<T> {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    throw badRequest("Invalid request body");
  }
  return validate(schema, json);
}

/** Validates ?query parameters with a zod schema. */
export function parseQuery<T>(url: string | URL, schema: ZodType<T>): T {
  return validate(schema, Object.fromEntries(new URL(url, "http://local").searchParams.entries()));
}

export function validate<T>(schema: ZodType<T>, data: unknown): T {
  const r = schema.safeParse(data);
  if (r.success) return r.data;
  throw zodToApi(r.error);
}

function zodToApi(e: ZodError) {
  const fields: Record<string, string> = {};
  for (const i of e.issues) fields[i.path.join(".") || "_"] ??= i.message;
  return badRequest(Object.values(fields)[0] ?? "Invalid input", fields);
}

/** Wraps a handler so results get the standard envelope and thrown ApiErrors become clean JSON; unexpected errors never leak internals. */
export function handle<A extends unknown[]>(fn: (...args: A) => Promise<unknown>) {
  return async (...args: A) => {
    const req = args[0] instanceof Request ? args[0] : undefined;
    const mutating = !!req && req.method !== "GET" && req.method !== "HEAD";
    try {
      if (mutating) assertSameOrigin(req!);
      const out = await fn(...args);
      if (mutating && persistenceActive()) await flush();
      if (out instanceof Response) return out;
      return success(out);
    } catch (e) {
      // A failed request may still have changed state (e.g. a rate-limit audit), so persist what happened.
      if (mutating && persistenceActive()) await flush();
      return failure(e);
    }
  };
}
