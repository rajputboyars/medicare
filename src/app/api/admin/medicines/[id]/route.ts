import { z } from "zod";
import { handle, parseBody, requireElevated } from "@/server/http";
import { setMedicineStatus, updateMedicine } from "@/server/features/catalog/medicine-admin.service";
import { medicineInputSchema } from "../route";

/** Edit a catalogue medicine (normalised search fields are rebuilt) or retire / restore it. */
export const PATCH = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const u = await requireElevated();
  const { id } = await ctx.params;
  const body = await parseBody(req, medicineInputSchema.partial().extend({ status: z.enum(["ACTIVE", "INACTIVE"]).optional() }));
  const { status, ...patch } = body;
  if (status) setMedicineStatus(u, id, status);
  return Object.keys(patch).length ? updateMedicine(u, id, patch) : updateMedicine(u, id, {});
});
