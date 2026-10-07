import { z } from "zod";
import { pincodeSchema } from "@/lib/validation";
import { handle, validate } from "@/server/http";
import { searchMedicines } from "@/server/services/finder";

const schema = z.object({
  q: z.string().trim().max(80).optional(),
  pincode: pincodeSchema,
  category: z.string().max(40).optional(),
  brand: z.string().max(40).optional(),
  rx: z.enum(["yes", "no"]).optional(),
  maxPrice: z.coerce.number().positive().optional(),
  limit: z.coerce.number().int().min(1).max(60).optional(),
  availableNearby: z.enum(["1", "0"]).optional(),
});

export const GET = handle(async (req: Request) => {
  const sp = Object.fromEntries(new URL(req.url).searchParams);
  const p = validate(schema, sp);
  return searchMedicines({ ...p, availableNearby: p.availableNearby === "1" });
});
