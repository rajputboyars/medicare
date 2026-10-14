import { z } from "zod";
import { handle, parseBody, requireUser } from "@/server/http";
import { rejectOrder } from "@/server/features/orders/orders.service";

export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const u = await requireUser("order:fulfil");
  const { note } = await parseBody(req, z.object({ note: z.string().trim().min(3, "Tell the customer why").max(240) }));
  const o = rejectOrder(u, (await ctx.params).id, note);
  return { id: o.id, status: o.status };
});
