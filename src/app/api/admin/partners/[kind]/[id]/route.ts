import { z } from "zod";
import { handle, notFound, parseBody, requireElevated } from "@/server/http";
import { isPartnerKind, setVerification } from "@/server/features/admin/admin.service";

const schema = z.object({ status: z.enum(["VERIFIED", "REJECTED", "SUSPENDED", "PENDING"]), note: z.string().trim().max(240).optional() });

export const PATCH = handle(async (req: Request, ctx: { params: Promise<{ kind: string; id: string }> }) => {
  const u = await requireElevated();
  const { kind, id } = await ctx.params;
  if (!isPartnerKind(kind)) throw notFound();
  const b = await parseBody(req, schema);
  const row = setVerification(u, kind, id, b.status, b.note);
  return { id: row.id, verification: row.verification };
});
