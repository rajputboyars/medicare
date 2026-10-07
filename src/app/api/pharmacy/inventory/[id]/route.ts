import { z } from "zod";
import { handle, parseBody, requireUser } from "@/server/http";
import { quickStockUpdate } from "@/server/services/pharmacy";

export const PATCH = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const u = await requireUser("inventory:manage");
  const { quantity } = await parseBody(req, z.object({ quantity: z.number().int().min(0).max(100000) }));
  return quickStockUpdate(u, (await ctx.params).id, quantity);
});
