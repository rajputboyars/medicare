import { cancelOrderSchema, toCancelInput } from "@/lib/validation";
import { handle, parseBody, requireElevated } from "@/server/http";
import { cancelOrder, userSafeOrder } from "@/server/features/orders/orders.service";

/** Support cancels an order. After pickup this is allowed only once the parcel is back at the pharmacy (returned). */
export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const u = await requireElevated();
  const b = await parseBody(req, cancelOrderSchema);
  return userSafeOrder(cancelOrder(u, (await ctx.params).id, toCancelInput(b)), u);
});
