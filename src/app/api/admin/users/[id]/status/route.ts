import { z } from "zod";
import { handle, parseBody, requireElevated } from "@/server/http";
import { setUserStatus } from "@/server/features/admin/admin.service";

/** Suspend or reinstate an account. SENSITIVE (needs a recent password confirmation). Suspending signs the person out everywhere. */
export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const u = await requireElevated();
  const { status } = await parseBody(req, z.object({ status: z.enum(["ACTIVE", "SUSPENDED"]) }).strict());
  return setUserStatus(u, (await ctx.params).id, status);
});
