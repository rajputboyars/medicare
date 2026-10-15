import { cookies } from "next/headers";
import { SESSION_COOKIE, verifySession } from "@/lib/auth";
import { can, type Permission } from "@/lib/rbac";
import type { Role, SessionUser } from "@/lib/types";
import { ApiError, forbidden, unauthenticated } from "../errors";
import { isElevated, validateSession } from "../features/auth/session.service";
import { db } from "../store";

/**
 * The signed-in user, or null. Three things must all be true:
 *  1. the cookie is a valid, unexpired token we signed
 *  2. the server-side SESSION it names exists and is not revoked or expired
 *  3. the account still exists, is ACTIVE and has the same role
 * So signing out, "log out everywhere", suspending an account, or changing a role takes effect on the very next request.
 */
export async function currentUser(): Promise<SessionUser | null> {
  const jar = await cookies();
  const token = await verifySession(jar.get(SESSION_COOKIE)?.value);
  if (!token) return null;
  const live = validateSession(token.sessionId, token.id, token.role);
  if (!live) return null;
  const { user, session } = live;
  // An admin whose second factor was never checked is treated as signed out when MFA is on for the account.
  if (session.kind === "ADMIN" && !session.mfaVerified && user.mfa?.enabled) return null;
  return { id: user.id, name: user.name, role: user.role, partnerId: user.partnerId, sessionId: session.id, elevated: isElevated(session.id) };
}

/** Auth guard: 401 when nobody is signed in; 403 when a permission is required and the role lacks it. */
export async function requireUser(permission?: Permission): Promise<SessionUser> {
  const u = await currentUser();
  if (!u) throw unauthenticated();
  if (permission && !can(u.role, permission)) throw forbidden();
  return u;
}

/** Role guard: only the listed roles may continue. Prefer `requireUser(permission)`; use this for role-only areas. */
export async function requireRole(...roles: Role[]): Promise<SessionUser> {
  const u = await requireUser();
  if (!roles.includes(u.role)) throw forbidden();
  return u;
}

/**
 * For sensitive admin actions (approve / reject / suspend a partner, change money settings, create settlements, revoke sessions).
 * The admin must have re-entered their password within the last few minutes. The 403 carries the code ELEVATION_REQUIRED so
 * the screen can ask for the password and retry.
 */
export async function requireElevated(permission: Permission = "admin:write"): Promise<SessionUser> {
  const u = await requireUser(permission);
  if (!u.elevated) throw new ApiError(403, "Please confirm your password to continue.", undefined, "ELEVATION_REQUIRED");
  return u;
}

/** A signed-in partner role. Applicants have no partner profile yet, so this does not look at partnerId. */
export async function requireApplicant(type: "PHARMACY" | "RIDER"): Promise<SessionUser> {
  const u = await requireRole(type === "PHARMACY" ? "PHARMACY_ADMIN" : "DELIVERY_PARTNER");
  // Staff of an existing pharmacy (no application of their own) are not applicants
  if (u.partnerId && !db().partnerApplications.some((a) => a.userId === u.id)) throw forbidden();
  return u;
}

/** Ownership guard for customer resources: the row must belong to the caller (platform admins may look). */
export function assertOwner(ownerId: string | undefined, user: Pick<SessionUser, "id" | "role">) {
  if (ownerId !== user.id && user.role !== "SUPER_ADMIN") throw forbidden();
}

/** Pharmacy staff may only touch their own pharmacy's rows. */
export function assertPharmacy(pharmacyId: string | undefined, user: Pick<SessionUser, "partnerId" | "role">) {
  if (user.role === "SUPER_ADMIN") return;
  if (!user.partnerId || user.partnerId !== pharmacyId) throw forbidden();
}
