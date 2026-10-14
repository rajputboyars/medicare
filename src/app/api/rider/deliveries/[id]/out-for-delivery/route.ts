import { handle, requireUser } from "@/server/http";
import { riderStep } from "@/server/features/delivery/delivery.service";

export const POST = handle(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const u = await requireUser("delivery:execute");
  return riderStep(u, (await ctx.params).id, "START");
});
