import { z } from "zod";
import { handle, limit, parseBody, requireUser } from "@/server/http";
import { reviewPrescription } from "@/server/features/orders/orders.service";

/** Pharmacist, pharmacy admin or platform admin only. If the prescription belongs to an order under review, the order moves with it. */
export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const u = await requireUser("prescription:review");
  await limit("rx-review", 120, 60 * 60_000, u.id);
  const b = await parseBody(req, z.object({ note: z.string().trim().min(3, "Tell the customer why").max(240) }));
  const rx = reviewPrescription(u, (await ctx.params).id, "REJECT", b.note);
  return { id: rx.id, status: rx.status };
});
