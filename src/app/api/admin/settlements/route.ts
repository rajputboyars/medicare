import { handle, requireElevated } from "@/server/http";
import { generateSettlements } from "@/server/features/admin/admin.service";

/** Creates pending settlements for delivered, not-yet-settled pharmacy orders. */
export const POST = handle(async () => {
  const u = await requireElevated();
  const created = generateSettlements(u);
  return { created: created.length, settlements: created };
});
