import { z } from "zod";
import { handle, limit, parseBody, requireUser } from "@/server/http";
import { grantConsent } from "@/server/features/support/assisted-orders.service";

/** Step 2: the customer reads the code out and the pharmacy enters it. Consent lasts 30 minutes and covers one order. */
export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const u = await requireUser("order:fulfil");
  await limit("assisted-verify", 20, 10 * 60_000, u.id);
  const b = await parseBody(req, z.object({ code: z.string().trim().regex(/^\d{6}$/, "Enter the 6-digit code"), customerName: z.string().trim().max(80).optional() }).strict());
  return grantConsent(u, (await ctx.params).id, b);
});
