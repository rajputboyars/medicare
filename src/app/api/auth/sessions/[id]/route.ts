import { ApiError, handle, requireUser } from "@/server/http";
import { db } from "@/server/store";
import { revokeSession } from "@/server/features/auth/session.service";

/** Sign one of MY devices out. Other people's sessions cannot be touched here. */
export const DELETE = handle(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const u = await requireUser();
  const { id } = await ctx.params;
  const s = db().sessions.find((x) => x.id === id && x.userId === u.id);
  if (!s) throw new ApiError(404, "Session not found");
  return { revoked: revokeSession(id, "user-revoked") };
});
