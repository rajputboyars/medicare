import { z } from "zod";
import { deliveryOtpSchema } from "@/lib/validation";
import { handle, limit, parseBody, requireUser } from "@/server/http";
import { acceptDelivery, riderStep } from "@/server/services/delivery";

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("accept") }),
  z.object({ action: z.literal("pickup"), otp: deliveryOtpSchema.shape.otp }),
  z.object({ action: z.literal("start") }),
  z.object({ action: z.literal("deliver"), otp: deliveryOtpSchema.shape.otp }),
  z.object({ action: z.literal("drop") }),
]);

export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const u = await requireUser("delivery:execute");
  const { id } = await ctx.params;
  await limit("otp", 8, 10 * 60_000, `${u.id}:${id}`); // brute-forcing a 4-digit code is blocked
  const b = await parseBody(req, schema);
  switch (b.action) {
    case "accept": return acceptDelivery(u, id);
    case "pickup": return riderStep(u, id, "PICKUP", b.otp);
    case "start": return riderStep(u, id, "START");
    case "deliver": return riderStep(u, id, "DELIVER", b.otp);
    case "drop": return riderStep(u, id, "DROP");
  }
});
