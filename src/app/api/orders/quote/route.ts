import { z } from "zod";
import { handle, parseBody, requireUser } from "@/server/http";
import { quoteOrder } from "@/server/services/orders";

const schema = z.object({
  pharmacyId: z.string().min(1),
  addressId: z.string().min(1),
  items: z.array(z.object({ medicineId: z.string(), quantity: z.number().int().min(1).max(20) })).min(1),
  offerCode: z.string().max(20).optional(),
});

export const POST = handle(async (req: Request) => quoteOrder(await requireUser("order:create"), await parseBody(req, schema)));
