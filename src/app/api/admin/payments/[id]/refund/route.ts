import { refundSchema } from "@/lib/validation";
import { badRequest, handle, parseBody, requireElevated } from "@/server/http";
import { idempotencyKeyFrom } from "@/server/idempotency";
import { adminRefund } from "@/server/features/payments/payment.service";

/** Support refunds money (all that is left, or an amount). The Idempotency-Key is required so a repeat can never refund twice. Retrying a FAILED refund with the same key re-sends it. */
export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const u = await requireElevated();
  const key = idempotencyKeyFrom(req);
  if (!key) throw badRequest("Send an Idempotency-Key header with a refund");
  const b = await parseBody(req, refundSchema);
  return adminRefund(u, (await ctx.params).id, { ...b, key });
});
