import { handle, limit, requireUser } from "@/server/http";
import { acceptDelivery } from "@/server/features/delivery/delivery.service";

export const POST = handle(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const u = await requireUser("delivery:execute");
  await limit("rider-accept", 60, 60 * 60_000, u.id);
  return acceptDelivery(u, (await ctx.params).id);
});
