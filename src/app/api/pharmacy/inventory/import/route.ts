import { badRequest, handle, limit, requireUser } from "@/server/http";
import { WithMessage } from "@/server/core/response";
import { CSV_TEMPLATE, importSummary, previewImport } from "@/server/features/inventory/import.service";

/** Download the CSV template. */
export const GET = handle(async () => {
  await requireUser("inventory:manage");
  return { filename: "inventory-template.csv", csv: CSV_TEMPLATE };
});

/**
 * Step 1 of CSV import: upload and PREVIEW. Nothing is saved. Every row comes back as MATCHED, POSSIBLE_MATCH, NOT_FOUND or
 * INVALID, so the pharmacy can check before confirming.
 */
export const POST = handle(async (req: Request) => {
  const u = await requireUser("inventory:manage");
  await limit("inv-import", 20, 60 * 60_000, u.id);
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) throw badRequest("Attach a CSV file");
  if (file.size > 1_000_000) throw badRequest("The file must be smaller than 1 MB");
  if (!/\.csv$/i.test(file.name)) throw badRequest("Please upload a .csv file");
  const imp = previewImport(u, file.name, await file.text());
  return new WithMessage({ ...importSummary(imp), rows: imp.rows.slice(0, 500) }, "Check the preview, then confirm", 201);
});
