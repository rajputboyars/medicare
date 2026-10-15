import { z } from "zod";
import { handle, parseBody, requireElevated } from "@/server/http";
import { adjustSettlement } from "@/server/features/settlements/settlements.service";

/** A signed correction (bonus or penalty) with a reason; audited with before and after. */
export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const u = await requireElevated();
  const { amount, reason } = await parseBody(req, z.object({ amount: z.number().min(-100000).max(100000), reason: z.string().trim().min(3).max(200) }).strict());
  return adjustSettlement(u, (await ctx.params).id, amount, reason);
});
