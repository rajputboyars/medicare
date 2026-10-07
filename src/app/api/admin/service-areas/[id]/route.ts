import { z } from "zod";
import { handle, parseBody, requireUser } from "@/server/http";
import { setServiceArea } from "@/server/services/admin";

export const PATCH = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const u = await requireUser("admin:write");
  const { active } = await parseBody(req, z.object({ active: z.boolean() }));
  return setServiceArea(u, (await ctx.params).id, active);
});
