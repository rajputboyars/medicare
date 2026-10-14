import { handle, paginate, requireUser } from "@/server/http";
import { adminList } from "@/server/features/admin/admin.service";

type Row = ReturnType<typeof adminList> extends (infer R)[] ? R : never;
export const GET = handle(async (req: Request) => {
  await requireUser("admin:read");
  const rows = adminList("orders") as Extract<Row, { code: string }>[];
  return paginate(rows, req.url, {
    sortable: { createdAt: (o) => o.createdAt, total: (o) => o.total, status: (o) => o.status },
    filters: { status: (o) => o.status, paymentStatus: (o) => o.paymentStatus, paymentMethod: (o) => o.paymentMethod },
    search: (o) => `${o.code} ${o.customer ?? ""} ${o.pharmacy ?? ""}`,
    defaultSort: "createdAt:desc",
  });
});
