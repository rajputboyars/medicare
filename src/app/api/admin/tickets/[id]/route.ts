import { z } from "zod";
import { handle, parseBody, requireUser } from "@/server/http";
import { updateTicket } from "@/server/features/admin/admin.service";

export const PATCH = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const u = await requireUser("admin:write");
  const { status } = await parseBody(req, z.object({ status: z.enum(["OPEN", "IN_PROGRESS", "RESOLVED"]) }));
  return updateTicket(u, (await ctx.params).id, status);
});
