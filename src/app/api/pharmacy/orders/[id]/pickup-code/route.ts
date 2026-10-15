import { handle, limit, requireUser } from "@/server/http";
import { refreshPickupCode } from "@/server/features/orders/orders.service";

/** A fresh pickup code (the old one expired or was shared by mistake). The wrong-guess counter starts again. */
export const POST = handle(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const u = await requireUser("order:fulfil");
  await limit("pickup-code", 10, 60 * 60_000, u.id);
  return refreshPickupCode(u, (await ctx.params).id);
});
