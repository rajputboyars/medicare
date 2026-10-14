import { z } from "zod";
import { handle, parseBody, requireUser } from "@/server/http";
import { cancelOrder, userSafeOrder } from "@/server/features/orders/orders.service";

/** Customers cancel their own order until pickup. Stock and payment are released by the state machine. */
export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const u = await requireUser("order:create");
  const { reason } = await parseBody(req, z.object({ reason: z.string().trim().min(2).max(160) }));
  return userSafeOrder(cancelOrder(u, (await ctx.params).id, reason), u);
});
