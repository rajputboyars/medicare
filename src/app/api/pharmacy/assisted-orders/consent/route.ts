import { z } from "zod";
import { mobileSchema } from "@/lib/validation";
import { WithMessage } from "@/server/core/response";
import { handle, limit, parseBody, requireUser } from "@/server/http";
import { requestConsent } from "@/server/features/support/assisted-orders.service";
import { devOtpField, dispatchOtp } from "@/server/features/auth/http-helpers";

/** Step 1: a code is sent to the CUSTOMER's phone. The pharmacy never sees it until the customer reads it out. */
export const POST = handle(async (req: Request) => {
  const u = await requireUser("order:fulfil");
  await limit("assisted-consent", 20, 60 * 60_000, u.id);
  const { mobile } = await parseBody(req, z.object({ mobile: mobileSchema }).strict());
  const { consent, code, isNewCustomer } = requestConsent(u, { mobile });
  await dispatchOtp(mobile, code, "ASSISTED_CONSENT");
  return new WithMessage({ consentId: consent.id, isNewCustomer, expiresAt: consent.expiresAt, ...devOtpField(code) }, "Code sent to the customer");
});
