import { z } from "zod";
import { handle, parseBody, requireUser } from "@/server/http";
import { mockComplete } from "@/server/features/payments/payment.service";

/** Development only (mock gateway, never in production): plays the part of the gateway's checkout page by sending a signed webhook. */
export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const u = await requireUser("order:create");
  const { outcome } = await parseBody(req, z.object({ outcome: z.enum(["success", "failure"]) }).strict());
  return mockComplete(u, (await ctx.params).id, outcome);
});
