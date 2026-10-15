import { handle, requireUser } from "@/server/http";
import { listMySessions, revokeAllSessions } from "@/server/features/auth/session.service";

/** My signed-in devices. */
export const GET = handle(async () => {
  const u = await requireUser();
  return listMySessions(u.id, u.sessionId);
});

/** "Log out of all other devices". Add ?all=1 to include this one. */
export const DELETE = handle(async (req: Request) => {
  const u = await requireUser();
  const all = new URL(req.url).searchParams.get("all") === "1";
  return { revoked: revokeAllSessions(u.id, "user-revoked-all", all ? undefined : u.sessionId) };
});
