import { handle, requireUser } from "@/server/http";
import { analyticsSummary } from "@/server/analytics";

/** Event counts for the last 30 days (a simple funnel view). */
export const GET = handle(async () => {
  await requireUser("admin:read");
  return analyticsSummary();
});
