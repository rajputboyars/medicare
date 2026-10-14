import { cookies } from "next/headers";
import { SESSION_COOKIE, verifySession } from "@/lib/auth";
import { can, type Permission } from "@/lib/rbac";
import type { Role, SessionUser } from "@/lib/types";
import { ApiError, forbidden } from "../errors";
import { db } from "../store";

/** The signed-in user, or null. The cookie must be valid AND the account must still exist with the same role. */
export async function currentUser(): Promise<SessionUser | null> {
  const jar = await cookies();
  const s = await verifySession(jar.get(SESSION_COOKIE)?.value);
  if (!s) return null;
  const live = db().users.find((u) => u.id === s.id);
  // A token outlives a deleted or re-roled account for up to its lifetime, so the role inside it is never trusted on its own.
  if (!live || live.role !== s.role) return null;
  return { id: live.id, name: live.name, role: live.role, partnerId: live.partnerId };
}

/** Auth guard: 401 when nobody is signed in; 403 when a permission is required and the role lacks it. */
export async function requireUser(permission?: Permission): Promise<SessionUser> {
  const u = await currentUser();
  if (!u) throw new ApiError(401, "Please log in to continue");
  if (permission && !can(u.role, permission)) throw forbidden();
  return u;
}

/** Role guard: only the listed roles may continue. Prefer `requireUser(permission)`; use this for role-only areas. */
export async function requireRole(...roles: Role[]): Promise<SessionUser> {
  const u = await requireUser();
  if (!roles.includes(u.role)) throw forbidden();
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
