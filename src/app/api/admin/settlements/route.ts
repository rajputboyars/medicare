import { handle, requireUser } from "@/server/http";
import { generateSettlements } from "@/server/services/admin";

/** Creates pending settlements for delivered, not-yet-settled pharmacy orders. */
export const POST = handle(async () => {
  const u = await requireUser("admin:write");
  const created = generateSettlements(u);
  return { created: created.length, settlements: created };
});
