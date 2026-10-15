import { handle, requireElevated } from "@/server/http";
import { revokeUserSessions } from "@/server/features/admin/admin.service";

/** Sign a person out of every device. SENSITIVE. */
export const POST = handle(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const u = await requireElevated();
  return revokeUserSessions(u, (await ctx.params).id);
});
