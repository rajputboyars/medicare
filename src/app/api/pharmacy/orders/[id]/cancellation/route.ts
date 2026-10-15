import { cancellationDecisionSchema } from "@/lib/validation";
import { handle, parseBody, requireUser } from "@/server/http";
import { decideCancellation } from "@/server/features/orders/orders.service";

/** The pharmacy answers a customer's request to cancel an order it already started preparing. */
export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const u = await requireUser("order:fulfil");
  const { decision, note } = await parseBody(req, cancellationDecisionSchema);
  const o = decideCancellation(u, (await ctx.params).id, decision, note);
  return { id: o.id, status: o.status, cancellationRequest: o.cancellationRequest };
});
