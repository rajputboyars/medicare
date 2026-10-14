import { handle, requireUser } from "@/server/http";
import { advanceAsPharmacy } from "@/server/features/orders/orders.service";

export const POST = handle(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const u = await requireUser("order:fulfil");
  const o = advanceAsPharmacy(u, (await ctx.params).id, "ready");
  return { id: o.id, status: o.status };
});
