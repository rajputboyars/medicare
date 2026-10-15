import { handle, requireUser } from "@/server/http";
import { confirmReturnReceived } from "@/server/features/delivery/delivery.service";

/** The parcel from a failed delivery is back at the pharmacy. Support is alerted to cancel and refund, or arrange a new delivery. */
export const POST = handle(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const u = await requireUser("order:fulfil");
  const dl = confirmReturnReceived(u, (await ctx.params).id);
  return { deliveryId: dl.id, status: dl.status, returnedAt: dl.returnedAt };
});
