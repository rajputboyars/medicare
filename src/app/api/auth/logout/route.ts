import { failure, success, WithMessage } from "@/server/core/response";
import { assertSameOrigin, currentUser } from "@/server/http";
import { clearSessionCookie } from "@/server/features/auth/http-helpers";
import { revokeSession } from "@/server/features/auth/session.service";
import { flush, persistenceActive } from "@/server/persistence";

/** Ends THIS device's session on the server (deleting the cookie alone would not be enough) and clears the cookie. */
export async function POST(req: Request) {
  try {
    assertSameOrigin(req);
  } catch (e) {
    return failure(e);
  }
  const u = await currentUser();
  if (u?.sessionId) revokeSession(u.sessionId, "logout");
  if (persistenceActive()) await flush();
  const res = success(new WithMessage({ ok: true }, "Logged out"));
  clearSessionCookie(res);
  return res;
}
