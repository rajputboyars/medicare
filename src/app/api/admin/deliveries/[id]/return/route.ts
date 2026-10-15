import { z } from "zod";
import { handle, parseBody, requireElevated } from "@/server/http";
import { returnDelivery } from "@/server/features/delivery/delivery.service";

/** Support: bring the parcel of a failed delivery back to the pharmacy. */
export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const u = await requireElevated();
  const { note } = await parseBody(req, z.object({ note: z.string().trim().max(240).optional() }).strict());
  const dl = returnDelivery(u, (await ctx.params).id, note);
  return { id: dl.id, status: dl.status, returnStartedAt: dl.returnStartedAt };
});
