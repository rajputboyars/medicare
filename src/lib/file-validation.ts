export const ALLOWED_UPLOAD_TYPES = ["image/jpeg", "image/png", "image/webp", "application/pdf"] as const;
export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

const SIGNATURES: { type: string; bytes: number[] }[] = [
  { type: "image/jpeg", bytes: [0xff, 0xd8, 0xff] },
  { type: "image/png", bytes: [0x89, 0x50, 0x4e, 0x47] },
  { type: "application/pdf", bytes: [0x25, 0x50, 0x44, 0x46] },
  { type: "image/webp", bytes: [0x52, 0x49, 0x46, 0x46] }, // RIFF
];

export type FileCheck = { ok: true; type: string } | { ok: false; error: string };

/** Validates declared type, size and real magic bytes so renamed executables are rejected. */
export function validateUpload(file: { type: string; size: number }, head: Uint8Array): FileCheck {
  if (file.size <= 0) return { ok: false, error: "File is empty" };
  if (file.size > MAX_UPLOAD_BYTES) return { ok: false, error: "File is larger than 8 MB" };
  if (!(ALLOWED_UPLOAD_TYPES as readonly string[]).includes(file.type))
    return { ok: false, error: "Only JPG, PNG, WebP or PDF files are allowed" };
  const sig = SIGNATURES.find((s) => s.type === file.type);
  if (!sig || !sig.bytes.every((b, i) => head[i] === b)) return { ok: false, error: "File content does not match its type" };
  return { ok: true, type: file.type };
}
