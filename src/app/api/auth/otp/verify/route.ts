import { success, WithMessage } from "@/server/core/response";
import { otpVerifySchema } from "@/lib/validation";
import { handle, limit, parseBody, requestMeta } from "@/server/http";
import { verifyAuthOtp } from "@/server/features/auth/auth.service";
import { sessionPayload, setSessionCookie } from "@/server/features/auth/http-helpers";

/** Step 2: check the code. Known mobile → signed in. New mobile → a short token to finish a minimal profile. */
export const POST = handle(async (req: Request) => {
  await limit("otp-verify", 30, 10 * 60_000);
  const body = await parseBody(req, otpVerifySchema);
  const out = await verifyAuthOtp(body, await requestMeta(req));
  if (out.kind === "SIGNUP") return new WithMessage({ isNewUser: true, signupToken: out.signupToken }, "Number verified");
  const res = success(new WithMessage({ isNewUser: false, ...sessionPayload(out.issued) }, "Logged in"));
  setSessionCookie(res, out.issued.token, out.issued.expiresAt);
  return res;
});
