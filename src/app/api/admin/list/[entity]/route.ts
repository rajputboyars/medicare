import { handle, notFound, paginate, requireUser } from "@/server/http";
import { ADMIN_ENTITIES, adminList, type AdminEntity } from "@/server/features/admin/admin.service";
import { audit } from "@/server/store";

type AnyRow = Record<string, unknown>;
const text = (v: unknown) => (typeof v === "string" || typeof v === "number" ? String(v) : undefined);

/** Admin tables (customers, orders, requests, payments, settlements, complaints, audit). ?status= · ?q= · ?sort=createdAt:desc · ?page=&limit= */
export const GET = handle(async (req: Request, ctx: { params: Promise<{ entity: string }> }) => {
  const u = await requireUser("admin:read");
  const { entity } = await ctx.params;
  if (!(ADMIN_ENTITIES as readonly string[]).includes(entity)) throw notFound();
  if (entity === "customers") audit(u, "ADMIN_LIST_VIEWED", entity, "*");
  const rows = adminList(entity as AdminEntity) as AnyRow[];
  return paginate(rows, req.url, {
    sortable: { createdAt: (r) => text(r.createdAt ?? r.joinedAt ?? r.at) },
    filters: { status: (r) => text(r.status), paymentStatus: (r) => text(r.paymentStatus), action: (r) => text(r.action) },
    search: (r) => JSON.stringify(r),
    defaultSort: "createdAt:desc", defaultLimit: 100,
  });
});
