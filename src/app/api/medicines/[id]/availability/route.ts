import { pincodeSchema } from "@/lib/validation";
import { handle, notFound, validate } from "@/server/http";
import { offersFor, pincodeCenter } from "@/server/services/finder";
import { db } from "@/server/store";

export const GET = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const pincode = validate(pincodeSchema, new URL(req.url).searchParams.get("pincode"));
  const medicine = db().medicines.find((m) => m.id === id);
  if (!medicine) throw notFound("Medicine not found");
  const offers = offersFor(id, pincode, pincodeCenter(pincode), medicine.prescriptionRequired);
  return { medicine, offers };
});
