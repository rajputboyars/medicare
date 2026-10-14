import { handle, paginate, requireUser } from "@/server/http";
import { db } from "@/server/store";

export const GET = handle(async (req: Request) => {
  const u = await requireUser();
  return paginate(db().notifications.filter((n) => n.userId === u.id), req.url, {
    sortable: { createdAt: (n) => n.createdAt },
    filters: { read: (n) => String(n.read), event: (n) => n.event },
    defaultSort: "createdAt:desc", defaultLimit: 30,
  });
});
