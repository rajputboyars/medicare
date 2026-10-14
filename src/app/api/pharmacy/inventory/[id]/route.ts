import { z } from "zod";
import { handle, parseBody, requireUser } from "@/server/http";
import { inventoryItemSchema } from "@/lib/validation";
import { quickStockUpdate, upsertInventory } from "@/server/features/pharmacy/pharmacy.service";

export const PATCH = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const u = await requireUser("inventory:manage");
  const { stockQuantity } = await parseBody(req, z.object({ stockQuantity: z.number().int().min(0).max(100000) }));
  return quickStockUpdate(u, (await ctx.params).id, stockQuantity);
});

/** Full edit of one stock line (batch, expiry, prices, quantity). Quick +/- uses PATCH. */
export const PUT = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const u = await requireUser("inventory:manage");
  return upsertInventory(u, await parseBody(req, inventoryItemSchema), (await ctx.params).id);
});
