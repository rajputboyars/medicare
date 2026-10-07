import { z } from "zod";
import { handle, parseBody, requireUser } from "@/server/http";
import { userSafeOrder } from "@/server/services/orders";
import { deleteSaved, reorderSaved, toggleReminder } from "@/server/services/requests";

type Ctx = { params: Promise<{ id: string }> };

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("reminder"), on: z.boolean() }),
  z.object({ action: z.literal("reorder"), addressId: z.string().min(1), paymentMethod: z.enum(["UPI", "COD", "CARD", "WALLET"]) }),
]);

export const POST = handle(async (req: Request, ctx: Ctx) => {
  const u = await requireUser("order:create");
  const b = await parseBody(req, schema);
  const { id } = await ctx.params;
  if (b.action === "reminder") return toggleReminder(u.id, id, b.on);
  return userSafeOrder(reorderSaved(u, id, b.addressId, b.paymentMethod), u);
});

export const DELETE = handle(async (_req: Request, ctx: Ctx) => {
  const u = await requireUser("order:create");
  deleteSaved(u.id, (await ctx.params).id);
  return { ok: true };
});
