import { z } from "zod";
import { handle, parseBody, requireUser } from "@/server/http";
import { updateCallback } from "@/server/features/support/support.service";

export const PATCH = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const u = await requireUser("admin:write");
  const b = await parseBody(req, z.object({ status: z.enum(["OPEN", "CONTACTED", "CLOSED"]), note: z.string().trim().max(300).optional() }).strict());
  return updateCallback(u, (await ctx.params).id, b);
});
