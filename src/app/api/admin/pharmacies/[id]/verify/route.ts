import { z } from "zod";
import { handle, parseBody, requireUser } from "@/server/http";
import { setVerification } from "@/server/features/admin/admin.service";

const schema = z.object({ status: z.enum(["VERIFIED", "REJECTED", "SUSPENDED", "PENDING"]), note: z.string().trim().max(240).optional() });

/** Approve, reject or suspend a pharmacy. Written to the audit log. */
export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const u = await requireUser("admin:write");
  const b = await parseBody(req, schema);
  const row = setVerification(u, "pharmacies", (await ctx.params).id, b.status, b.note);
  return { id: row.id, verification: row.verification };
});
