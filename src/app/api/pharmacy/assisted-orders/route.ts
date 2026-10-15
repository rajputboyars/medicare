import { z } from "zod";
import { addressSchema } from "@/lib/validation";
import { WithMessage } from "@/server/core/response";
import { handle, limit, parseBody, requireUser } from "@/server/http";
import { assistedOrdersOf, placeAssistedOrder } from "@/server/features/support/assisted-orders.service";

export const GET = handle(async () => assistedOrdersOf(await requireUser("order:fulfil")));

const schema = z.object({
  consentId: z.string().min(1),
  addressId: z.string().optional(),
  newAddress: addressSchema.optional(),
  items: z.array(z.object({ medicineId: z.string().min(1), quantity: z.number().int().min(1).max(20) }).strict()).min(1).max(20),
  deliveryType: z.enum(["NORMAL", "PRIORITY"]).default("NORMAL"),
}).strict();

/** Places ONE order for a customer who gave consent (see the consent endpoints). Over-the-counter medicines, cash on delivery. */
export const POST = handle(async (req: Request) => {
  const u = await requireUser("order:fulfil");
  await limit("assisted-order", 30, 60 * 60_000, u.id);
  const order = placeAssistedOrder(u, await parseBody(req, schema));
  return new WithMessage({ id: order.id, code: order.code, status: order.status, total: order.total }, "Order placed for the customer", 201);
});
