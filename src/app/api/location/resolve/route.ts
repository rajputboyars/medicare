import { locationQuerySchema } from "@/lib/validation";
import { handle, limit, parseQuery } from "@/server/http";
import { resolveLocation } from "@/server/features/service-areas/service-areas.service";

/**
 * Where is this person and do we deliver there? Public (guests can search medicines), throttled.
 * Accepts ?pincode=261001 or ?lat=..&lng=.. (GPS is used once to find the nearest pincode and is not stored).
 */
export const GET = handle(async (req: Request) => {
  await limit("location", 60, 10 * 60_000);
  return resolveLocation(parseQuery(req.url, locationQuerySchema));
});
