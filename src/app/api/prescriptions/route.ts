import { prescriptionMetaSchema } from "@/lib/validation";
import { badRequest, handle, limit, requireUser, validate } from "@/server/http";
import { listPrescriptions, storePrescription } from "@/server/services/prescriptions";
import { db } from "@/server/store";

export const GET = handle(async () => {
  const u = await requireUser();
  return listPrescriptions(u).map(({ fileKey: _k, ...rx }) => { void _k; return rx; });
});

export const POST = handle(async (req: Request) => {
  const u = await requireUser("order:create");
  await limit("rx-upload", 10, 60 * 60_000, u.id);
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) throw badRequest("Please attach a prescription photo or PDF");
  const meta = validate(prescriptionMetaSchema, {
    familyMemberId: form.get("familyMemberId") || undefined,
    requestedMedicines: String(form.get("requestedMedicines") ?? "").split(",").map((s) => s.trim()).filter(Boolean),
    consent: String(form.get("consent") ?? ""),
  });
  if (meta.familyMemberId && !db().familyMembers.some((f) => f.id === meta.familyMemberId && f.userId === u.id)) throw badRequest("Unknown family member");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const rx = storePrescription({ userId: u.id, file: { name: file.name, type: file.type, bytes }, familyMemberId: meta.familyMemberId, requestedMedicines: meta.requestedMedicines, source: "UPLOAD" });
  return { id: rx.id, status: rx.status };
});
