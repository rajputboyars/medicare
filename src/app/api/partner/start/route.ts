import { z } from "zod";
import { success, WithMessage } from "@/server/core/response";
import { verifyPurposeToken } from "@/lib/auth";
import { ApiError, handle, limit, parseBody, requestMeta } from "@/server/http";
import { createApplicantAccount } from "@/server/features/onboarding/applications.service";
import { createSession } from "@/server/features/auth/session.service";
import { sessionPayload, setSessionCookie } from "@/server/features/auth/http-helpers";

const schema = z.object({
  signupToken: z.string().min(20).max(2000),
  name: z.string().trim().min(2, "Enter your name").max(80),
  type: z.enum(["PHARMACY", "RIDER"]),
}).strict();

/**
 * Partner onboarding, step 1: a mobile number that was just verified with a one-time code (/api/auth/otp/*) becomes an
 * applicant. This creates the account and an empty DRAFT application, never a pharmacy or rider profile.
 */
export const POST = handle(async (req: Request) => {
  await limit("partner-start", 10, 60 * 60_000);
  const body = await parseBody(req, schema);
  const claims = await verifyPurposeToken(body.signupToken, "signup");
  if (!claims?.mobile) throw new ApiError(401, "Please verify your mobile number again.", undefined, "SIGNUP_EXPIRED");
  const { user } = createApplicantAccount({ mobile: claims.mobile, name: body.name, type: body.type });
  const session = await createSession(user, await requestMeta(req), { mfaVerified: true });
  const res = success(new WithMessage(sessionPayload({ user, ...session }), "Application started", 201));
  setSessionCookie(res, session.token, session.expiresAt);
  return res;
});
