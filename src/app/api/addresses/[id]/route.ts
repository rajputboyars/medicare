import { handle, requireUser } from "@/server/http";
import { deleteAddress } from "@/server/services/accounts";

export const DELETE = handle(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const u = await requireUser();
  deleteAddress(u.id, (await ctx.params).id);
  return { ok: true };
});
