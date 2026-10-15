import { success, WithMessage } from "@/server/core/response";
import { mfaVerifySchema } from "@/lib/validation";
import { handle, limit, parseBody, requestMeta } from "@/server/http";
import { verifyAdminMfa } from "@/server/features/auth/auth.service";
import { sessionPayload, setSessionCookie } from "@/server/features/auth/http-helpers";

/** Admin sign-in, step 2: the code sent to the admin's mobile. */
export const POST = handle(async (req: Request) => {
  await limit("mfa-verify", 20, 10 * 60_000);
  const issued = await verifyAdminMfa(await parseBody(req, mfaVerifySchema), await requestMeta(req));
  const res = success(new WithMessage(sessionPayload(issued), "Logged in"));
  setSessionCookie(res, issued.token, issued.expiresAt);
  return res;
});
