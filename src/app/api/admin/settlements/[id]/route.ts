import { z } from "zod";
import { handle, parseBody, requireUser } from "@/server/http";
import { setSettlementStatus } from "@/server/services/admin";

export const PATCH = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const u = await requireUser("admin:write");
  const { status } = await parseBody(req, z.object({ status: z.enum(["PENDING", "PROCESSING", "PAID"]) }));
  return setSettlementStatus(u, (await ctx.params).id, status);
});
