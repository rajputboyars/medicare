import { z } from "zod";
import { WithMessage } from "@/server/core/response";
import { badRequest, handle, limit, requireRole } from "@/server/http";
import { applicantView, applicationOf, documentView, uploadDocument } from "@/server/features/onboarding/applications.service";

const kinds = z.enum(["DRUG_LICENSE", "SHOP_IMAGE", "PHARMACIST_CERTIFICATE", "GST_CERTIFICATE", "OTHER_BUSINESS", "ID_PROOF", "DRIVING_LICENSE", "VEHICLE_RC", "PROFILE_PHOTO"]);

/** Upload one document (multipart: kind, label?, file). Type, size and file signature are checked; the file is stored privately. */
export const POST = handle(async (req: Request) => {
  const u = await requireRole("PHARMACY_ADMIN", "DELIVERY_PARTNER");
  await limit("partner-doc", 40, 60 * 60_000, u.id);
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) throw badRequest("Please choose a photo or PDF");
  const kind = kinds.safeParse(form.get("kind"));
  if (!kind.success) throw badRequest("Unknown document type");
  const label = typeof form.get("label") === "string" ? String(form.get("label")) : undefined;
  const doc = uploadDocument(u, { kind: kind.data, label, file: { name: file.name, type: file.type, bytes: new Uint8Array(await file.arrayBuffer()) } });
  return new WithMessage({ document: documentView(doc), application: applicantView(applicationOf(u)) }, "Uploaded", 201);
});
