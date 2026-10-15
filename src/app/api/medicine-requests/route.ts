import { medicineRequestSchema } from "@/lib/validation";
import { badRequest, handle, limit, requireUser, validate } from "@/server/http";
import { storePrescription } from "@/server/features/prescriptions/prescriptions.service";
import { createMedicineRequest, myRequests } from "@/server/features/medicine-requests/requests.service";

export const GET = handle(async () => myRequests(await requireUser()));

/** Accepts JSON, or multipart when the customer attaches a photo of the medicine or strip. */
export const POST = handle(async (req: Request) => {
  // Signed-in customers only: a request shares a phone number and optionally a prescription with nearby pharmacies
  const u = await requireUser("order:create");
  await limit("medreq", 6, 60 * 60_000, u.id);
  let fields: Record<string, unknown>;
  let photo: File | null = null;
  if ((req.headers.get("content-type") ?? "").includes("multipart/form-data")) {
    const form = await req.formData();
    fields = Object.fromEntries([...form.entries()].filter(([, v]) => typeof v === "string"));
    const f = form.get("photo");
    if (f instanceof File && f.size > 0) photo = f;
  } else {
    try { fields = await req.json(); } catch { throw badRequest("Invalid request body"); }
  }
  const b = validate(medicineRequestSchema, fields);
  let photoRxId: string | undefined;
  if (photo) {
    photoRxId = storePrescription({ userId: u.id, file: { name: photo.name, type: photo.type, bytes: new Uint8Array(await photo.arrayBuffer()) }, requestedMedicines: [b.medicineQuery], source: "REQUEST" }).id;
  }
  return createMedicineRequest({ ...b, strength: b.strength || undefined, prescriptionId: b.prescriptionId || undefined, familyMemberId: b.familyMemberId || undefined, photoRxId }, u.id);
});
