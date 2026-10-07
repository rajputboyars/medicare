import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Short-lived signed URLs for private medical files (prescriptions, reports).
 * The URL carries no medical info – only an opaque file key, expiry and the bound user id.
 */
function key(): string {
  const s = process.env.FILE_SIGNING_SECRET;
  if (!s && process.env.NODE_ENV === "production") throw new Error("FILE_SIGNING_SECRET required");
  return s ?? "dev-file-signing-secret";
}

const sign = (fileKey: string, exp: number, uid: string) =>
  createHmac("sha256", key()).update(`${fileKey}.${exp}.${uid}`).digest("base64url");

export function signFileUrl(fileKey: string, userId: string, ttlSec = Number(process.env.FILE_URL_TTL_SECONDS ?? 300)): string {
  const exp = Math.floor(Date.now() / 1000) + ttlSec;
  return `/api/files/${encodeURIComponent(fileKey)}?exp=${exp}&uid=${encodeURIComponent(userId)}&sig=${sign(fileKey, exp, userId)}`;
}

export function verifyFileSignature(fileKey: string, exp: number, uid: string, sig: string): boolean {
  if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) return false;
  const expected = Buffer.from(sign(fileKey, exp, uid));
  const given = Buffer.from(sig);
  return expected.length === given.length && timingSafeEqual(expected, given);
}
