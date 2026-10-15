import { partialProposalSchema } from "@/lib/validation";
import { handle, parseBody, requireUser } from "@/server/http";
import { proposePartialFulfillment } from "@/server/features/orders/partial-fulfillment";

/** The pharmacy lists what it cannot supply. Nothing changes until the customer answers. */
export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const u = await requireUser("order:fulfil");
  const { items } = await parseBody(req, partialProposalSchema);
  const o = proposePartialFulfillment(u, (await ctx.params).id, items);
  return { id: o.id, partialFulfillment: o.partialFulfillment };
});
