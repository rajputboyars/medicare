import { success, WithMessage } from "@/server/core/response";
import { loginSchema } from "@/lib/validation";
import { handle, limit, parseBody, requestMeta } from "@/server/http";
import { passwordLogin } from "@/server/features/auth/auth.service";
import { devOtpField, dispatchOtp, sessionPayload, setSessionCookie } from "@/server/features/auth/http-helpers";

/**
 * Password sign-in for staff, pharmacy owners with a password, and admins. (Customers and partners use /api/auth/otp/*.)
 * Wrong passwords are counted per account and lock it for 15 minutes after 5 failures. Admins also need a second factor.
 */
export const POST = handle(async (req: Request) => {
  const body = await parseBody(req, loginSchema);
  await limit("login", 20, 10 * 60_000); // per IP
  await limit("login-id", 10, 10 * 60_000, body.identifier.toLowerCase()); // per account name
  const out = await passwordLogin(body, await requestMeta(req));
  if (out.kind === "MFA_REQUIRED") {
    await dispatchOtp(out.mobile, out.code, "ADMIN_MFA");
    return new WithMessage({ mfaRequired: true, mfaToken: out.mfaToken, mobileHint: out.mobileHint, ...devOtpField(out.code) }, "Enter the code we sent to your mobile");
  }
  const res = success(new WithMessage(sessionPayload(out.issued), "Logged in"));
  setSessionCookie(res, out.issued.token, out.issued.expiresAt);
  return res;
});
