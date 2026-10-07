import { handle, requireUser } from "@/server/http";
import { db } from "@/server/store";

export const GET = handle(async () => {
  const u = await requireUser();
  return db().notifications.filter((n) => n.userId === u.id).slice(0, 30);
});
