import { cancelOrderSchema, toCancelInput } from "@/lib/validation";
import { handle, parseBody, requireUser } from "@/server/http";
import { cancelOrder, userSafeOrder } from "@/server/features/orders/orders.service";

/**
 * The customer cancels with a reason code (CHANGED_MIND, TOO_SLOW...). Until the pharmacy starts preparing it happens at once;
 * after that it becomes a request the pharmacy answers; once the parcel is picked up it is refused (see policy.ts).
 * Stock is released and any online payment is refunded by the state machine.
 */
export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const u = await requireUser("order:create");
  const b = await parseBody(req, cancelOrderSchema);
  return userSafeOrder(cancelOrder(u, (await ctx.params).id, toCancelInput(b)), u);
});
