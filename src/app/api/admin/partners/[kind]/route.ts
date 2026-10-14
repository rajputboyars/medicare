import { handle, notFound, requireUser } from "@/server/http";
import { isPartnerKind, listPartners } from "@/server/features/admin/admin.service";

export const GET = handle(async (_req: Request, ctx: { params: Promise<{ kind: string }> }) => {
  await requireUser("admin:read");
  const { kind } = await ctx.params;
  if (!isPartnerKind(kind)) throw notFound();
  return listPartners(kind);
});
