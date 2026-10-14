import { handle, requireUser } from "@/server/http";
import { cancelMedicineRequest, requestFor } from "@/server/features/medicine-requests/requests.service";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handle(async (_req: Request, ctx: Ctx) => requestFor(await requireUser(), (await ctx.params).id));

/** Stop searching. */
export const DELETE = handle(async (_req: Request, ctx: Ctx) => {
  const u = await requireUser();
  const r = cancelMedicineRequest(u, (await ctx.params).id);
  return { id: r.id, status: r.status };
});
