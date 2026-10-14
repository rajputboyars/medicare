import { handle, paginate, requireUser } from "@/server/http";
import { listRiderRows } from "@/server/features/admin/admin.service";

export const GET = handle(async (req: Request) => {
  await requireUser("admin:read");
  return paginate(listRiderRows(), req.url, {
    sortable: { name: (r) => r.name.toLowerCase(), deliveries: (r) => r.deliveries, earned: (r) => r.earned, joinedAt: (r) => r.joinedAt },
    filters: { verification: (r) => r.verification, status: (r) => r.status },
    search: (r) => `${r.name} ${r.mobile}`,
    defaultSort: "name:asc",
  });
});
