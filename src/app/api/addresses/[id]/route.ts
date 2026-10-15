import { addressSchema } from "@/lib/validation";
import { handle, parseBody, requireUser } from "@/server/http";
import { deleteAddress, updateAddress } from "@/server/features/accounts/accounts.service";

type Ctx = { params: Promise<{ id: string }> };

/** Edit an address or make it the default. Only the owner's own addresses. */
export const PATCH = handle(async (req: Request, ctx: Ctx) => {
  const u = await requireUser("order:create");
  return updateAddress(u.id, (await ctx.params).id, await parseBody(req, addressSchema.partial()));
});

export const DELETE = handle(async (_req: Request, ctx: Ctx) => {
  const u = await requireUser("order:create");
  deleteAddress(u.id, (await ctx.params).id);
  return { ok: true };
});
