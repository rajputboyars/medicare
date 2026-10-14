import { z } from "zod";
import { handle, parseBody, requireUser } from "@/server/http";
import { quickStockUpdate } from "@/server/features/pharmacy/pharmacy.service";

/** Quick +/- from the shelf. Cannot go below the units already promised to open orders. */
export const PATCH = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const u = await requireUser("inventory:manage");
  const { stockQuantity } = await parseBody(req, z.object({ stockQuantity: z.number().int().min(0).max(100000) }));
  return quickStockUpdate(u, (await ctx.params).id, stockQuantity);
});
