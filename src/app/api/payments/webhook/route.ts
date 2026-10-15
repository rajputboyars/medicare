import { ApiError, handle } from "@/server/http";
import { processWebhook } from "@/server/features/payments/payment.service";

/**
 * The payment gateway calls this server-to-server. There is no user session; the guard is the gateway's SIGNATURE over the raw
 * body (checked before anything is read or changed). The event id makes repeats harmless, the amount and order are matched
 * against our own records, and only this path can mark an online payment PAID.
 */
export const POST = handle(async (req: Request) => {
  const raw = await req.text();
  if (raw.length > 64 * 1024) throw new ApiError(413, "Payload too large");
  return processWebhook(raw, req.headers.get("x-signature") ?? req.headers.get("x-razorpay-signature"));
});
