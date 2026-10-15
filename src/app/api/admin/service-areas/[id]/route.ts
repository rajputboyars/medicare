import { z } from "zod";
import { handle, parseBody, requireElevated } from "@/server/http";
import { setServiceArea } from "@/server/features/admin/admin.service";

export const PATCH = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const u = await requireElevated();
  const { status } = await parseBody(req, z.object({ status: z.enum(["ACTIVE", "COMING_SOON", "DISABLED"]) }));
  return setServiceArea(u, (await ctx.params).id, status);
});
