import { success, WithMessage } from "@/server/core/response";
import { signupSchema } from "@/lib/validation";
import { handle, limit, parseBody, requestMeta } from "@/server/http";
import { completeSignup } from "@/server/features/auth/auth.service";
import { sessionPayload, setSessionCookie } from "@/server/features/auth/http-helpers";

/**
 * Finishes signup for a mobile number that was just verified: name, language and pincode, nothing else.
 * If we do not deliver to that pincode yet, no account is created; the number is saved as an interest instead.
 */
export const POST = handle(async (req: Request) => {
  await limit("register", 10, 60 * 60_000);
  const out = await completeSignup(await parseBody(req, signupSchema), await requestMeta(req));
  if (out.status === "UNAVAILABLE") return new WithMessage({ status: "UNAVAILABLE", interestSaved: true }, out.message);
  const res = success(new WithMessage({ status: "CREATED", ...sessionPayload(out.issued) }, "Welcome to DawaDost", 201));
  setSessionCookie(res, out.issued.token, out.issued.expiresAt);
  return res;
});
