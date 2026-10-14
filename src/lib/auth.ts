import { SignJWT, jwtVerify } from "jose";
import type { SessionUser } from "./types";

/**
 * Cookie name. In production the `__Host-` prefix makes browsers insist on: Secure, Path=/, no Domain.
 * That stops a sibling sub-domain from planting or overwriting our session cookie.
 */
export const SESSION_COOKIE = process.env.NODE_ENV === "production" ? "__Host-mc_session" : "mc_session";

function secret(): Uint8Array {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 32) {
    if (process.env.NODE_ENV === "production") throw new Error("AUTH_SECRET must be set (>= 32 chars) in production");
    return new TextEncoder().encode("dev-only-insecure-secret-change-me-0123456789");
  }
  return new TextEncoder().encode(s);
}

/**
 * The cookie value. It only NAMES the server-side session (`sid`); whether that session is still valid (not revoked, not
 * expired) is decided by the server on every request. The role inside is a hint for edge redirects, never for authorization.
 */
export async function signSession(user: SessionUser, opts: { sessionId: string; expiresAt: Date }): Promise<string> {
  return new SignJWT({ name: user.name, role: user.role, partnerId: user.partnerId, sid: opts.sessionId })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime(Math.floor(opts.expiresAt.getTime() / 1000))
    .sign(secret());
}

/** Edge-safe verification (used by proxy.ts and server handlers). Returns null for any invalid token. */
export async function verifySession(token?: string | null): Promise<SessionUser | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret(), { algorithms: ["HS256"] });
    if (!payload.sub || typeof payload.role !== "string" || typeof payload.sid !== "string") return null;
    return {
      id: payload.sub,
      name: String(payload.name ?? ""),
      role: payload.role as SessionUser["role"],
      partnerId: payload.partnerId as string | undefined,
      sessionId: payload.sid,
    };
  } catch {
    return null;
  }
}

/** Short-lived, single-purpose tokens (finish signup after the mobile was verified; finish admin sign-in after the password). */
export async function signPurposeToken(purpose: "signup" | "mfa", claims: Record<string, string>, ttlSeconds: number): Promise<string> {
  return new SignJWT({ ...claims, purpose })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + ttlSeconds)
    .sign(secret());
}

export async function verifyPurposeToken(token: string | undefined, purpose: "signup" | "mfa"): Promise<Record<string, string> | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret(), { algorithms: ["HS256"] });
    if (payload.purpose !== purpose) return null;
    return Object.fromEntries(Object.entries(payload).filter(([, v]) => typeof v === "string")) as Record<string, string>;
  } catch {
    return null;
  }
}

export const cookieOptions = (expiresAt: Date) => ({
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  expires: expiresAt,
});
