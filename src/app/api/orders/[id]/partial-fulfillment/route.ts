import { partialDecisionSchema } from "@/lib/validation";
import { handle, parseBody, requireUser } from "@/server/http";
import { decidePartialFulfillment } from "@/server/features/orders/partial-fulfillment";
import { userSafeOrder } from "@/server/features/orders/orders.service";

/** The customer answers "some medicines are not available": CONTINUE with the rest, or CANCEL the whole order. */
export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const u = await requireUser("order:create");
  const { decision } = await parseBody(req, partialDecisionSchema);
  return userSafeOrder(decidePartialFulfillment(u, (await ctx.params).id, decision), u);
});
