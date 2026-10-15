import { quickOrderSchema } from "@/lib/validation";
import { badRequest, handle, limit, requireUser, validate } from "@/server/http";
import { quickOrder } from "@/server/features/prescriptions/prescriptions.service";

/** "Upload a prescription and call me". Needs a signed-in customer (guests use the call-back form instead). */
export const POST = handle(async (req: Request) => {
  const u = await requireUser("order:create");
  await limit("quick-order", 4, 60 * 60_000, u.id);
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) throw badRequest("Please attach a prescription photo");
  const meta = validate(quickOrderSchema, { mobile: form.get("mobile"), pincode: form.get("pincode"), addressText: form.get("addressText") });
  const bytes = new Uint8Array(await file.arrayBuffer());
  return quickOrder({ ...meta, userId: u.id, file: { name: file.name, type: file.type, bytes } });
});
