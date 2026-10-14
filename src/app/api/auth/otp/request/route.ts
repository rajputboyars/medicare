import { WithMessage } from "@/server/core/response";
import { otpRequestSchema } from "@/lib/validation";
import { handle, limit, parseBody, requestMeta } from "@/server/http";
import { requestAuthOtp } from "@/server/features/auth/auth.service";
import { OTP } from "@/server/features/auth/config";
import { devOtpField, dispatchOtp } from "@/server/features/auth/http-helpers";

/**
 * Step 1: send a code to a mobile number. The answer is the same whether or not the number already has an account.
 * Throttled by IP here, and per mobile (cooldown, hourly cap) inside the service.
 */
export const POST = handle(async (req: Request) => {
  await limit("otp-request", 15, 60 * 60_000);
  const { mobile } = await parseBody(req, otpRequestSchema);
  const meta = await requestMeta(req);
  const { challengeId, code } = requestAuthOtp(mobile, meta);
  await dispatchOtp(mobile, code, "AUTH");
  return new WithMessage({ challengeId, expiresInSec: OTP.ttlMs / 1000, resendAfterSec: OTP.resendCooldownMs / 1000, ...devOtpField(code) }, "Code sent");
});
