import { z } from "zod";
import { handle, parseBody, requireUser } from "@/server/http";
import { approveOrder } from "@/server/features/orders/orders.service";

/** Prescription order under review: verifies the prescription. Otherwise accepts (confirms) the order. */
export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const u = await requireUser("order:fulfil");
  const { note } = await parseBody(req, z.object({ note: z.string().trim().max(240).optional() }));
  const o = approveOrder(u, (await ctx.params).id, note);
  return { id: o.id, status: o.status };
});
