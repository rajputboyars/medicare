import { paymentRetrySchema } from "@/lib/validation";
import { handle, limit, parseBody, requireUser } from "@/server/http";
import { retryPayment } from "@/server/features/payments/payment.service";

/** After a failed payment: pay online again (same order, new attempt) or switch to cash on delivery when eligible. Never creates a second order. */
export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const u = await requireUser("order:create");
  await limit("payment-retry", 20, 60 * 60_000, u.id);
  const { method } = await parseBody(req, paymentRetrySchema);
  return retryPayment(u, (await ctx.params).id, { method });
});
