import { signSession } from "@/lib/auth";
import type { Session, SessionUser, User } from "@/lib/types";
import { audit, db, uid } from "../../store";
import { ELEVATION_MS, SESSION_TTL, TOUCH_EVERY_MS } from "./config";

export interface RequestMeta { ip?: string; userAgent?: string }

/** Admins get short sessions; partners medium; customers long. */
export function policyFor(user: Pick<User, "role">) {
  return user.role === "SUPER_ADMIN" ? SESSION_TTL.ADMIN : user.role === "CUSTOMER" ? SESSION_TTL.CUSTOMER : SESSION_TTL.PARTNER;
}

export const sessionUserOf = (u: User, s: Session): SessionUser => ({ id: u.id, name: u.name, role: u.role, partnerId: u.partnerId, sessionId: s.id });

/** Starts a server-side session and returns the cookie value. */
export async function createSession(user: User, meta: RequestMeta = {}, opts: { mfaVerified?: boolean } = {}): Promise<{ session: Session; token: string; expiresAt: Date }> {
  const now = Date.now();
  const policy = policyFor(user);
  const session: Session = {
    id: uid("ses"), userId: user.id, kind: user.role === "SUPER_ADMIN" ? "ADMIN" : "STANDARD",
    createdAt: new Date(now).toISOString(), lastSeenAt: new Date(now).toISOString(),
    absoluteExpiresAt: new Date(now + policy.absolute).toISOString(), expiresAt: new Date(now + policy.idle).toISOString(),
    userAgent: meta.userAgent?.slice(0, 160), ip: meta.ip, mfaVerified: opts.mfaVerified ?? false,
  };
  db().sessions.push(session);
  const expiresAt = new Date(session.expiresAt);
  return { session, token: await signSession(sessionUserOf(user, session), { sessionId: session.id, expiresAt }), expiresAt };
}

/**
 * The server's answer to "is this cookie still good?". Fails (null) when the session is unknown, revoked or expired, or the
 * account no longer exists, is suspended, or changed role. Touching the session slides the idle deadline forward.
 */
export function validateSession(sessionId: string | undefined, userId: string, role: string): { session: Session; user: User } | null {
  if (!sessionId) return null;
  const d = db();
  const session = d.sessions.find((s) => s.id === sessionId && s.userId === userId);
  const now = Date.now();
  if (!session || session.revokedAt || Date.parse(session.expiresAt) <= now || Date.parse(session.absoluteExpiresAt) <= now) return null;
  const user = d.users.find((u) => u.id === userId);
  if (!user || user.status === "SUSPENDED" || user.role !== role) return null;
  if (now - Date.parse(session.lastSeenAt) > TOUCH_EVERY_MS) {
    session.lastSeenAt = new Date(now).toISOString();
    session.expiresAt = new Date(Math.min(Date.parse(session.absoluteExpiresAt), now + policyFor(user).idle)).toISOString();
  }
  return { session, user };
}

/** Issues a fresh cookie with a later idle deadline. Never goes past the absolute limit. */
export async function refreshSession(sessionId: string): Promise<{ token: string; expiresAt: Date; session: Session } | null> {
  const d = db();
  const session = d.sessions.find((s) => s.id === sessionId);
  const user = session && d.users.find((u) => u.id === session.userId);
  if (!session || !user || session.revokedAt) return null;
  const now = Date.now();
  if (Date.parse(session.expiresAt) <= now || Date.parse(session.absoluteExpiresAt) <= now) return null;
  session.lastSeenAt = new Date(now).toISOString();
  session.expiresAt = new Date(Math.min(Date.parse(session.absoluteExpiresAt), now + policyFor(user).idle)).toISOString();
  const expiresAt = new Date(session.expiresAt);
  return { session, expiresAt, token: await signSession(sessionUserOf(user, session), { sessionId: session.id, expiresAt }) };
}

export function revokeSession(sessionId: string, reason = "logout"): boolean {
  const s = db().sessions.find((x) => x.id === sessionId);
  if (!s || s.revokedAt) return false;
  s.revokedAt = new Date().toISOString();
  s.revokedReason = reason;
  return true;
}

/** Signs a person out everywhere (or everywhere except one device). */
export function revokeAllSessions(userId: string, reason: string, exceptSessionId?: string): number {
  let n = 0;
  for (const s of db().sessions) if (s.userId === userId && !s.revokedAt && s.id !== exceptSessionId) { s.revokedAt = new Date().toISOString(); s.revokedReason = reason; n++; }
  return n;
}

/** My devices. Never exposes anything that could be used to hijack one. */
export function listMySessions(userId: string, currentSessionId?: string) {
  const now = Date.now();
  return db().sessions
    .filter((s) => s.userId === userId && !s.revokedAt && Date.parse(s.expiresAt) > now && Date.parse(s.absoluteExpiresAt) > now)
    .sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt))
    .map((s) => ({ id: s.id, kind: s.kind, createdAt: s.createdAt, lastSeenAt: s.lastSeenAt, userAgent: s.userAgent, current: s.id === currentSessionId }));
}

/** Admin re-confirmed their identity: sensitive actions work for the next few minutes. */
export function grantElevation(sessionId: string, actor: SessionUser): string {
  const s = db().sessions.find((x) => x.id === sessionId);
  if (!s || s.revokedAt) throw new Error("no session");
  s.elevatedUntil = new Date(Date.now() + ELEVATION_MS).toISOString();
  audit(actor, "ADMIN_ELEVATED", "Session", s.id);
  return s.elevatedUntil;
}

export const isElevated = (sessionId: string | undefined) => {
  const s = sessionId ? db().sessions.find((x) => x.id === sessionId) : undefined;
  return !!s?.elevatedUntil && Date.parse(s.elevatedUntil) > Date.now();
};

/** Housekeeping: dead sessions older than a week are deleted. */
export function purgeSessions(at = Date.now()): number {
  const d = db();
  const before = d.sessions.length;
  d.sessions = d.sessions.filter((s) => Math.min(Date.parse(s.expiresAt), s.revokedAt ? Date.parse(s.revokedAt) : Infinity) > at - 7 * 86400_000);
  return before - d.sessions.length;
}
