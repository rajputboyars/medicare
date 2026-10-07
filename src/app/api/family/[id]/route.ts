import { familyMemberSchema } from "@/lib/validation";
import { handle, parseBody, requireUser } from "@/server/http";
import { deleteFamily, saveFamily } from "@/server/services/accounts";

type Ctx = { params: Promise<{ id: string }> };

export const PUT = handle(async (req: Request, ctx: Ctx) => {
  const u = await requireUser();
  return saveFamily(u.id, await parseBody(req, familyMemberSchema), (await ctx.params).id);
});
export const DELETE = handle(async (_req: Request, ctx: Ctx) => {
  const u = await requireUser();
  deleteFamily(u.id, (await ctx.params).id);
  return { ok: true };
});
