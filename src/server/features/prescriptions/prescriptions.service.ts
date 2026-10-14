import { validateUpload } from "@/lib/file-validation";
import type { Prescription, SessionUser } from "@/lib/types";
import { badRequest, forbidden, notFound } from "@/server/errors";
import { notify } from "@/server/features/notifications/notify";
import { db, uid } from "@/server/store";
import { coverageFor } from "@/server/features/service-areas/service-areas.service";

/** A prescription stops being usable for new orders this long after it was uploaded. */
export const PRESCRIPTION_VALID_DAYS = 180;
const EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "application/pdf": "pdf" };

export interface UploadInput {
  userId: string;
  file: { name: string; type: string; bytes: Uint8Array };
  familyMemberId?: string;
  requestedMedicines: string[];
  source: Prescription["source"];
  callbackMobile?: string;
}

export function storePrescription(i: UploadInput): Prescription {
  const check = validateUpload({ type: i.file.type, size: i.file.bytes.byteLength }, i.file.bytes.slice(0, 8));
  if (!check.ok) throw badRequest(check.error);
  const d = db();
  const id = uid("rx");
  // Opaque storage key: no names, no medical info; original file name is stored only in the DB record.
  const fileKey = `${id}.${EXT[i.file.type]}`;
  d.files.set(fileKey, { bytes: i.file.bytes, mimeType: i.file.type, ownerId: i.userId });
  const rx: Prescription = {
    id, userId: i.userId, familyMemberId: i.familyMemberId, fileKey, fileName: i.file.name.slice(0, 120), mimeType: i.file.type,
    sizeBytes: i.file.bytes.byteLength, status: "UPLOADED", requestedMedicines: i.requestedMedicines, source: i.source,
    callbackMobile: i.callbackMobile, expiresAt: new Date(Date.now() + PRESCRIPTION_VALID_DAYS * 86400_000).toISOString(), createdAt: new Date().toISOString(),
  };
  d.prescriptions.unshift(rx);
  return rx;
}

export function listPrescriptions(user: SessionUser) {
  return db().prescriptions.filter((p) => p.userId === user.id);
}

/** Who may open a private file: owner, the pharmacy reviewing it, or platform admin. Riders never. */
export function canAccessPrescription(user: SessionUser, rx: Prescription): boolean {
  if (rx.userId === user.id || user.role === "SUPER_ADMIN") return true;
  if (user.role === "PHARMACIST" || user.role === "PHARMACY_ADMIN") {
    const linked = db().orders.some((o) => o.prescriptionId === rx.id && o.pharmacyId === user.partnerId);
    // Files a customer chose to share with nearby pharmacies when asking "Find My Medicine"
    const ph = db().pharmacies.find((p) => p.id === user.partnerId);
    const sharedWithMe = !!ph && db().medicineRequests.some((r) => (r.photoRxId === rx.id || r.prescriptionId === rx.id) && ph.servicePincodes.includes(r.pincode));
    return linked || sharedWithMe || rx.pharmacyId === user.partnerId || (rx.source === "QUICK_ORDER" && !rx.pharmacyId);
  }
  return false;
}

export function prescriptionFor(user: SessionUser, id: string) {
  const rx = db().prescriptions.find((p) => p.id === id);
  if (!rx) throw notFound("Prescription not found");
  if (!canAccessPrescription(user, rx)) throw forbidden();
  return rx;
}

/** Quick order for people who find forms hard: mobile + address + photo → team calls back. */
export function quickOrder(input: { mobile: string; pincode: string; addressText: string; file: UploadInput["file"] }) {
  const d = db();
  const cover = coverageFor(input.pincode);
  if (!cover.available) throw badRequest(cover.message ?? "We're coming to your area. We can't take orders for this pincode yet.");
  const existing = d.users.find((u) => u.mobile === input.mobile);
  const owner = existing?.id ?? `guest:${input.mobile}`;
  const rx = storePrescription({ userId: owner, file: input.file, requestedMedicines: [], source: "QUICK_ORDER", callbackMobile: input.mobile });
  d.tickets.unshift({ id: uid("tk"), userId: owner, subject: "Quick order: call me", message: `Callback to ${input.mobile}. Deliver to: ${input.addressText} (${input.pincode}). Prescription ${rx.id}.`, status: "OPEN", createdAt: new Date().toISOString() });
  return { id: rx.id, status: rx.status };
}

export function remindRefill(userId: string, label: string) {
  notify(userId, "REFILL_REMINDER", "Time to refill", `Your ${label} refill is due soon.`);
}
