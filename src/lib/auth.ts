import { SignJWT, jwtVerify } from "jose";
import type { SessionUser } from "./types";

export const SESSION_COOKIE = "mc_session";

function secret(): Uint8Array {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 32) {
    if (process.env.NODE_ENV === "production") throw new Error("AUTH_SECRET must be set (>= 32 chars) in production");
    return new TextEncoder().encode("dev-only-insecure-secret-change-me-0123456789");
  }
  return new TextEncoder().encode(s);
}

const ttlHours = () => Number(process.env.SESSION_TTL_HOURS ?? 72);

export async function signSession(user: SessionUser): Promise<string> {
  return new SignJWT({ name: user.name, role: user.role, partnerId: user.partnerId })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime(`${ttlHours()}h`)
    .sign(secret());
}

/** Edge-safe verification (used by proxy.ts and server handlers). Returns null for any invalid token. */
export async function verifySession(token?: string | null): Promise<SessionUser | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret(), { algorithms: ["HS256"] });
    if (!payload.sub || typeof payload.role !== "string") return null;
    return {
      id: payload.sub,
      name: String(payload.name ?? ""),
      role: payload.role as SessionUser["role"],
      partnerId: payload.partnerId as string | undefined,
    };
  } catch {
    return null;
  }
}

export const cookieOptions = () => ({
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: ttlHours() * 3600,
});
