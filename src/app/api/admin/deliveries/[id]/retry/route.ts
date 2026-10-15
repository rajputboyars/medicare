import { z } from "zod";
import { handle, parseBody, requireElevated } from "@/server/http";
import { retryDelivery } from "@/server/features/delivery/delivery.service";

/** Support: try the failed delivery again. */
export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const u = await requireElevated();
  const { note } = await parseBody(req, z.object({ note: z.string().trim().max(240).optional() }).strict());
  const dl = retryDelivery(u, (await ctx.params).id, note);
  return { id: dl.id, status: dl.status, attemptNo: dl.attemptNo };
});
