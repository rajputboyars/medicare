import { handle, notFound } from "@/server/http";
import { db } from "@/server/store";

/** Master product data only. Price and stock are pharmacy-specific: see /api/medicines/[id]/availability. */
export const GET = handle(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const m = db().medicines.find((x) => x.id === id);
  if (!m) throw notFound("Medicine not found");
  return m;
});
