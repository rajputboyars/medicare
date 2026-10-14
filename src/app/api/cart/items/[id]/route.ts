import { z } from "zod";
import { handle, parseBody, requireUser } from "@/server/http";
import { removeCartItem, updateCartItem } from "@/server/features/medicine-requests/requests.service";

type Ctx = { params: Promise<{ id: string }> }; // id = medicineId

export const PATCH = handle(async (req: Request, ctx: Ctx) => {
  const u = await requireUser("order:create");
  const { quantity } = await parseBody(req, z.object({ quantity: z.number().int().min(1).max(20) }));
  return updateCartItem(u, (await ctx.params).id, quantity);
});

export const DELETE = handle(async (_req: Request, ctx: Ctx) => removeCartItem(await requireUser("order:create"), (await ctx.params).id));
