import { handle, paginate, requireUser } from "@/server/http";
import { listCallbacks } from "@/server/features/support/support.service";

/** Call-back requests from people who asked us to phone them. */
export const GET = handle(async (req: Request) => {
  await requireUser("admin:read");
  return paginate(listCallbacks(), req.url, {
    sortable: { createdAt: (c) => c.createdAt },
    filters: { status: (c) => c.status },
    search: (c) => `${c.mobile} ${c.name ?? ""} ${c.area} ${c.reason}`,
    defaultSort: "createdAt:desc",
  });
});
