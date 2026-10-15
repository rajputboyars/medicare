import { handle, requireUser } from "@/server/http";
import { cancelImport, getImport, importSummary } from "@/server/features/inventory/import.service";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handle(async (_req: Request, ctx: Ctx) => {
  const imp = getImport(await requireUser("inventory:manage"), (await ctx.params).id);
  return { ...importSummary(imp), rows: imp.rows.slice(0, 500) };
});

export const DELETE = handle(async (_req: Request, ctx: Ctx) => cancelImport(await requireUser("inventory:manage"), (await ctx.params).id));
