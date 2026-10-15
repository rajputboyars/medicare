import { z } from "zod";
import { pincodeSchema } from "@/lib/validation";
import { currentUser, handle, limit, parseQuery } from "@/server/http";
import { searchCatalog } from "@/server/features/catalog/catalog.service";

const bool = z.enum(["true", "false"]).transform((v) => v === "true");

const schema = z.object({
  q: z.string().trim().max(80).optional(),
  pincode: pincodeSchema,
  page: z.coerce.number().int().min(1).max(500).optional(),
  limit: z.coerce.number().int().min(1).max(40).optional(),
  prescriptionRequired: bool.optional(),
  availability: z.enum(["ALL", "AVAILABLE"]).optional(),
  sort: z.enum(["RELEVANCE", "PRICE", "ETA", "NAME"]).optional(),
  category: z.string().trim().max(40).optional(),
});

/**
 * Public medicine search (guests can use it). Searches name, generic name, brand, aliases and keywords; tolerates case,
 * spaces, hyphens and small typos ("Telma-40", "telma40", "telmisarten"). Each result carries the starting price, how many
 * verified pharmacies near the pincode have it, and the fastest honest delivery estimate.
 */
export const GET = handle(async (req: Request) => {
  await limit("search", 240, 10 * 60_000);
  const p = parseQuery(req.url, schema);
  const u = await currentUser();
  return searchCatalog({ ...p, userId: u?.role === "CUSTOMER" ? u.id : undefined });
});
