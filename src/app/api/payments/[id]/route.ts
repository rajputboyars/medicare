import { handle, requireUser } from "@/server/http";
import { getPaymentFor } from "@/server/features/payments/payment.service";

/** Payment status for the customer (or the pharmacy / admin looking at the order). */
export const GET = handle(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const u = await requireUser();
  return getPaymentFor(u, (await ctx.params).id);
});
