import { deliveryOtpSchema } from "@/lib/validation";
import { handle, limit, parseBody, requireUser } from "@/server/http";
import { riderStep } from "@/server/features/delivery/delivery.service";

/** The rider asks the customer for the delivery code. Cash on delivery is marked paid here. */
export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const u = await requireUser("delivery:execute");
  const { id } = await ctx.params;
  await limit("otp", 8, 10 * 60_000, `${u.id}:${id}`);
  const { otp } = await parseBody(req, deliveryOtpSchema);
  return riderStep(u, id, "DELIVER", otp);
});
