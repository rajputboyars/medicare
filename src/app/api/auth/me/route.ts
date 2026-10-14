import { currentUser, handle } from "@/server/http";
import { db } from "@/server/store";
import { publicUser } from "@/server/features/accounts/accounts.service";

/** Who am I? Answers `{ user: null }` when signed out (so screens can show the guest view without an error). */
export const GET = handle(async () => {
  const s = await currentUser();
  const u = s && db().users.find((x) => x.id === s.id);
  const session = s && db().sessions.find((x) => x.id === s.sessionId);
  return { user: u ? publicUser(u) : null, session: session ? { expiresAt: session.expiresAt, elevated: !!s?.elevated, kind: session.kind } : null };
});
