import { locationSchema } from "@/lib/validation";
import { handle, limit, parseBody, requireUser } from "@/server/http";
import { updateRiderLocation } from "@/server/features/delivery/delivery.service";

/** The assigned rider shares their current position. Only the latest point is kept; the customer sees it rounded. */
export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const u = await requireUser("delivery:execute");
  await limit("rider-location", 30, 60_000, u.id);
  const point = await parseBody(req, locationSchema);
  return updateRiderLocation(u, (await ctx.params).id, point);
});
