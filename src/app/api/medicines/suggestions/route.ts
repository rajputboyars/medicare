import { z } from "zod";
import { handle, limit, parseQuery } from "@/server/http";
import { suggestMedicines } from "@/server/features/catalog/catalog.service";

const schema = z.object({ q: z.string().trim().max(60).optional(), limit: z.coerce.number().int().min(1).max(10).optional() });

/** Fast autocomplete: a few names with strength and generic. The screen debounces its calls (about 250 ms). */
export const GET = handle(async (req: Request) => {
  await limit("suggest", 600, 10 * 60_000);
  const { q, limit: n } = parseQuery(req.url, schema);
  return suggestMedicines(q, n ?? 8);
});
