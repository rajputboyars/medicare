import { z } from "zod";
import { pincodeSchema } from "@/lib/validation";
import { handle, parseBody, requireUser } from "@/server/http";
import { pharmacyOf, updatePharmacySettings } from "@/server/services/pharmacy";

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const schema = z.object({
  openTime: time.optional(), closeTime: time.optional(),
  servicePincodes: z.array(pincodeSchema).min(1).max(30).optional(),
  deliveryRadiusKm: z.number().min(1).max(30).optional(),
  priorityDelivery: z.boolean().optional(), acceptingOrders: z.boolean().optional(),
});

export const GET = handle(async () => pharmacyOf(await requireUser("inventory:manage")));
export const PATCH = handle(async (req: Request) => {
  const u = await requireUser("pharmacy:manage");
  return updatePharmacySettings(u, await parseBody(req, schema));
});
