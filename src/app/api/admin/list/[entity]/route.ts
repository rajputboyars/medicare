import { handle, notFound, requireUser } from "@/server/http";
import { ADMIN_ENTITIES, adminList, type AdminEntity } from "@/server/services/admin";
import { audit } from "@/server/store";

export const GET = handle(async (_req: Request, ctx: { params: Promise<{ entity: string }> }) => {
  const u = await requireUser("admin:read");
  const { entity } = await ctx.params;
  if (!(ADMIN_ENTITIES as readonly string[]).includes(entity)) throw notFound();
  if (entity === "customers") audit(u, "ADMIN_LIST_VIEWED", entity, "*");
  return adminList(entity as AdminEntity);
});
