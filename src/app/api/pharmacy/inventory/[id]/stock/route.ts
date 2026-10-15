import { z } from "zod";
import { handle, parseBody, requireUser } from "@/server/http";
import { adjustStock, quickStockUpdate } from "@/server/features/pharmacy/pharmacy.service";

const schema = z.union([
  z.object({ stockQuantity: z.number().int().min(0).max(100000) }).strict(), // exact entry
  z.object({ delta: z.number().int().min(-10000).max(10000) }).strict(),    // + / − buttons
]);

/**
 * Quick stock update from the shelf: type the exact count, or add / remove a few. Never below zero, never below the units
 * already promised to open orders. Updates lastUpdatedAt and is written to the audit log.
 */
export const PATCH = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const u = await requireUser("inventory:manage");
  const b = await parseBody(req, schema);
  const { id } = await ctx.params;
  return "delta" in b ? adjustStock(u, id, b.delta) : quickStockUpdate(u, id, b.stockQuantity);
});
