import { completeDeliverySchema } from "@/lib/validation";
import { handle, limit, parseBody, requireUser } from "@/server/http";
import { riderStep } from "@/server/features/delivery/delivery.service";

/**
 * The rider asks the customer for the delivery code. For cash on delivery the rider also confirms the exact cash taken (cashCollected);
 * the cash is recorded first, then the order is delivered. Repeating the call after success returns the same result.
 */
export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const u = await requireUser("delivery:execute");
  const { id } = await ctx.params;
  await limit("otp", 8, 10 * 60_000, u.id + ":" + id);
  const { otp, cashCollected } = await parseBody(req, completeDeliverySchema);
  return riderStep(u, id, "DELIVER", otp, { cashCollected });
});
