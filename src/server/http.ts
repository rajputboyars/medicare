import { cookies, headers } from "next/headers";
import { NextResponse } from "next/server";
import { ZodError, type ZodType } from "zod";
import { SESSION_COOKIE, verifySession } from "@/lib/auth";
import { can, type Permission } from "@/lib/rbac";
import { rateLimiter } from "@/lib/rate-limit";
import type { SessionUser } from "@/lib/types";
import { ApiError, badRequest, conflict, forbidden, notFound } from "./errors";
import { flush, persistenceActive } from "./persistence";

export { ApiError, badRequest, forbidden, notFound, conflict };

export async function currentUser(): Promise<SessionUser | null> {
  const jar = await cookies();
  return verifySession(jar.get(SESSION_COOKIE)?.value);
}

export async function requireUser(permission?: Permission): Promise<SessionUser> {
  const u = await currentUser();
  if (!u) throw new ApiError(401, "Please log in to continue");
  if (permission && !can(u.role, permission)) throw forbidden();
  return u;
}

export async function clientKey(): Promise<string> {
  const h = await headers();
  return (h.get("x-forwarded-for")?.split(",")[0] ?? h.get("x-real-ip") ?? "local").trim();
}

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

/** Wraps a handler so thrown ApiErrors become clean JSON responses; unexpected errors never leak internals. */
export function handle<A extends unknown[]>(fn: (...args: A) => Promise<unknown>) {
  return async (...args: A) => {
    const req = args[0] instanceof Request ? args[0] : undefined;
    const mutating = !!req && req.method !== "GET" && req.method !== "HEAD";
    try {
      const out = await fn(...args);
      if (mutating && persistenceActive()) await flush();
      if (out instanceof Response) return out;
      return NextResponse.json({ data: out });
    } catch (e) {
      // A failed request may still have changed state (e.g. a rate-limit audit) – persist what happened.
      if (mutating && persistenceActive()) await flush();
      if (e instanceof ApiError) return NextResponse.json({ error: e.message, fields: e.fields }, { status: e.status });
      console.error("[api] unexpected error", e);
      return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
    }
  };
}
