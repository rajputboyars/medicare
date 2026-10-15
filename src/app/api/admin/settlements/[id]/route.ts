import { z } from "zod";
import { handle, parseBody, requireElevated } from "@/server/http";
import { setSettlementStatus } from "@/server/features/settlements/settlements.service";

export const PATCH = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const u = await requireElevated();
  const { status, holdReason } = await parseBody(req, z.object({ status: z.enum(["PENDING", "ELIGIBLE", "PROCESSING", "PAID", "ON_HOLD", "FAILED"]), holdReason: z.string().trim().max(200).optional() }).strict());
  return setSettlementStatus(u, (await ctx.params).id, status, holdReason);
});
