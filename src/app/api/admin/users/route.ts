import { handle, paginate, requireUser } from "@/server/http";
import { adminUsers } from "@/server/features/admin/admin.service";
import { audit } from "@/server/store";

/** Every account, any role. Password hashes never leave the server. */
export const GET = handle(async (req: Request) => {
  const u = await requireUser("admin:read");
  audit(u, "ADMIN_LIST_VIEWED", "users", "*");
  return paginate(adminUsers(), req.url, {
    sortable: { createdAt: (x) => x.createdAt, name: (x) => x.name.toLowerCase() },
    filters: { role: (x) => x.role },
    search: (x) => `${x.name} ${x.mobile} ${x.email ?? ""}`,
    defaultSort: "createdAt:desc",
  });
});
