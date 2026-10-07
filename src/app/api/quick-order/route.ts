import { quickOrderSchema } from "@/lib/validation";
import { badRequest, handle, limit, validate } from "@/server/http";
import { quickOrder } from "@/server/services/prescriptions";

/** Works without an account: mobile + address + photo. Heavily rate limited. */
export const POST = handle(async (req: Request) => {
  await limit("quick-order", 4, 60 * 60_000);
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) throw badRequest("Please attach a prescription photo");
  const meta = validate(quickOrderSchema, { mobile: form.get("mobile"), pincode: form.get("pincode"), addressText: form.get("addressText") });
  const bytes = new Uint8Array(await file.arrayBuffer());
  return quickOrder({ ...meta, file: { name: file.name, type: file.type, bytes } });
});
