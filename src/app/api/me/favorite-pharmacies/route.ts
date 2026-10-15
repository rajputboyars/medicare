import { z } from "zod";
import { handle, parseBody, requireUser } from "@/server/http";
import { favoritePharmacies, setFavoritePharmacy } from "@/server/features/catalog/catalog.service";

export const GET = handle(async () => favoritePharmacies(await requireUser("order:create")));

/** Mark or unmark a preferred pharmacy. Preferred pharmacies are badged in results; they are never the only ones shown. */
export const PUT = handle(async (req: Request) => {
  const u = await requireUser("order:create");
  const { pharmacyId, on } = await parseBody(req, z.object({ pharmacyId: z.string().min(1), on: z.boolean() }).strict());
  return setFavoritePharmacy(u, pharmacyId, on);
});
