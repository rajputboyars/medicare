import { failedDeliverySchema } from "@/lib/validation";
import { handle, parseBody, requireUser } from "@/server/http";
import { reportFailedDelivery } from "@/server/features/delivery/delivery.service";

/** The rider could not hand the parcel over. The order stays open; support decides to retry or return. */
export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const u = await requireUser("delivery:execute");
  const { reasonCode, note } = await parseBody(req, failedDeliverySchema);
  return reportFailedDelivery(u, (await ctx.params).id, reasonCode, note);
});
