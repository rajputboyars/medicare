import { badRequest, handle, limit, requireUser } from "@/server/http";
import { bulkUploadCsv } from "@/server/services/pharmacy";

export const POST = handle(async (req: Request) => {
  const u = await requireUser("inventory:manage");
  await limit("inv-bulk", 10, 60 * 60_000, u.id);
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) throw badRequest("Attach a CSV file");
  if (file.size > 1_000_000) throw badRequest("CSV must be smaller than 1 MB");
  return bulkUploadCsv(u, await file.text());
});
