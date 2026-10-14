import { currentUser, handle } from "@/server/http";
import { db } from "@/server/store";
import { publicUser } from "@/server/features/accounts/accounts.service";

export const GET = handle(async () => {
  const s = await currentUser();
  const u = s && db().users.find((x) => x.id === s.id); // currentUser() already re-checks the account
  return { user: u ? publicUser(u) : null };
});
