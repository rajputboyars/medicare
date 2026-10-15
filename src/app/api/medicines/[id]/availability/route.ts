import { z } from "zod";
import { pincodeSchema } from "@/lib/validation";
import { track } from "@/server/analytics";
import { currentUser, handle, parseQuery } from "@/server/http";
import { availabilityFor } from "@/server/features/catalog/catalog.service";

const schema = z.object({
  pincode: pincodeSchema,
  sort: z.enum(["FASTEST", "CHEAPEST", "NEAREST"]).optional(),
  lat: z.coerce.number().min(-90).max(90).optional(),
  lng: z.coerce.number().min(-180).max(180).optional(),
});

/**
 * Which verified pharmacies near this pincode have the medicine right now, with price, MRP, stock, distance, an honest
 * delivery estimate (or none), when the stock was last updated and how much to trust it. Sort: FASTEST | CHEAPEST | NEAREST.
 */
export const GET = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const q = parseQuery(req.url, schema);
  const u = await currentUser();
  const result = availabilityFor(id, { pincode: q.pincode, sort: q.sort, at: q.lat !== undefined && q.lng !== undefined ? { lat: q.lat, lng: q.lng } : undefined, userId: u?.role === "CUSTOMER" ? u.id : undefined });
  track("availability_viewed", {}, { medicine: id, pincode: q.pincode, offers: result.offers.length });
  return result;
}) as (req: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;
