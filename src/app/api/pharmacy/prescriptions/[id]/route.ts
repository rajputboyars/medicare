import { prescriptionReviewSchema } from "@/lib/validation";
import { handle, parseBody, requireUser } from "@/server/http";
import { reviewPrescription } from "@/server/services/orders";

export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const u = await requireUser("prescription:review");
  const b = await parseBody(req, prescriptionReviewSchema);
  const rx = reviewPrescription(u, (await ctx.params).id, b.decision, b.note);
  return { id: rx.id, status: rx.status };
});
