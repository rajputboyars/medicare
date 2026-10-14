import { success, WithMessage } from "@/server/core/response";
import { ApiError, handle, requireUser } from "@/server/http";
import { setSessionCookie } from "@/server/features/auth/http-helpers";
import { refreshSession } from "@/server/features/auth/session.service";

/** Moves the idle deadline forward and issues a fresh cookie. Never goes past the session's absolute limit. */
export const POST = handle(async () => {
  const u = await requireUser();
  const r = u.sessionId ? await refreshSession(u.sessionId) : null;
  if (!r) throw new ApiError(401, "Please log in again.");
  const res = success(new WithMessage({ expiresAt: r.expiresAt.toISOString() }, "Session refreshed"));
  setSessionCookie(res, r.token, r.expiresAt);
  return res;
});
