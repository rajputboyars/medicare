import { db } from "@/server/store";
import { grantElevation, createSession } from "@/server/features/auth/session.service";
import { jar } from "./next-headers";

export { jar };

export type Ctx = { params: Promise<Record<string, string>> };
export type Handler = (req: Request, ctx: Ctx) => Promise<Response>;
/* eslint-disable @typescript-eslint/no-explicit-any */
export interface Reply { status: number; body: { success: boolean; data: any; message: string | null; errors: { code: string; message: string; field?: string }[] | null; meta: any }; headers: Headers }
/* eslint-enable @typescript-eslint/no-explicit-any */

export const route = async (path: string) => (await import(/* @vite-ignore */ `@/app/api/${path}/route`)) as Record<string, Handler>;

/** Signs in as a seeded user with a REAL server-side session (like the login endpoints do). Admins are elevated unless told otherwise. */
export async function signIn(identifier?: string, opts: { elevate?: boolean } = {}) {
  jar.token = undefined;
  if (!identifier) return undefined;
  const u = db().users.find((x) => x.mobile === identifier || x.email === identifier)!;
  const { token, session } = await createSession(u, { ip: "127.0.0.1", userAgent: "vitest" }, { mfaVerified: true });
  jar.token = token;
  if (u.role === "SUPER_ADMIN" && opts.elevate !== false) grantElevation(session.id, { id: u.id, name: u.name, role: u.role });
  return { user: u, session, token };
}

export async function call(handler: Handler, method: string, url: string, opts: { body?: unknown; params?: Record<string, string>; headers?: Record<string, string> } = {}): Promise<Reply> {
  const req = new Request(`http://localhost${url}`, {
    method, headers: { ...(opts.body ? { "content-type": "application/json" } : {}), ...opts.headers },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const res = await handler(req, { params: Promise.resolve(opts.params ?? {}) });
  return { status: res.status, body: await res.json(), headers: res.headers };
}
