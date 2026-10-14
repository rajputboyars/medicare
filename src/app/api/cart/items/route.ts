import { z } from "zod";
import { handle, parseBody, requireUser } from "@/server/http";
import { addCartItem } from "@/server/features/medicine-requests/requests.service";

const schema = z.object({
  pharmacyId: z.string().min(1),
  medicineId: z.string().min(1),
  quantity: z.number().int().min(1).max(20),
  /** Start a new cart when the current one holds medicines from a different pharmacy */
  replaceCart: z.boolean().optional(),
});

export const POST = handle(async (req: Request) => {
  const u = await requireUser("order:create");
  return addCartItem(u, await parseBody(req, schema));
});
