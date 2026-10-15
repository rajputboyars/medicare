import { z } from "zod";
import { handle, limit, parseBody, requireUser } from "@/server/http";
import { createPaymentForOrder } from "@/server/features/payments/payment.service";

/** Open the online payment for one of my orders. Calling it again while a payment is open returns the same one. */
export const POST = handle(async (req: Request) => {
  const u = await requireUser("order:create");
  await limit("payment-create", 30, 60 * 60_000, u.id);
  const { orderId } = await parseBody(req, z.object({ orderId: z.string().min(1) }).strict());
  return createPaymentForOrder(u, orderId);
});
