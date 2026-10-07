import { currentUser, handle } from "@/server/http";
import { db } from "@/server/store";
import { publicUser } from "@/server/services/accounts";

export const GET = handle(async () => {
  const s = await currentUser();
  const u = s && db().users.find((x) => x.id === s.id);
  return { user: u ? publicUser(u) : null };
});
