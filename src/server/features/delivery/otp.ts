import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Delivery one-time codes.
 *
 * The database never holds a usable code. For each delivery we store a random `nonce` and a keyed hash of each code.
 * The 4-digit code shown to the pharmacy (pickup) or the customer (delivery) is re-derived on demand from the server
 * secret + nonce, so a copy of the database alone cannot reveal it. Verification compares hashes in constant time.
 * Wrong guesses are counted per delivery and locked (see MAX_OTP_ATTEMPTS) so a 4-digit code cannot be brute-forced.
 */
export type OtpPurpose = "PICKUP" | "DELIVERY";
export const MAX_OTP_ATTEMPTS = 5;

function key(): string {
  const s = process.env.OTP_SECRET ?? process.env.AUTH_SECRET;
  if (!s || s.length < 32) {
    if (process.env.NODE_ENV === "production") throw new Error("OTP_SECRET or AUTH_SECRET must be set (>= 32 chars) in production");
    return "dev-only-otp-secret-change-me-0123456789abcdef";
  }
  return s;
}

const mac = (data: string) => createHmac("sha256", key()).update(data).digest();

export const newNonce = () => randomBytes(12).toString("hex");

/** The 4-digit code for a delivery and purpose. Deterministic for (secret, deliveryId, nonce, purpose). */
export function deriveOtp(deliveryId: string, nonce: string, purpose: OtpPurpose): string {
  const n = mac(`otp:${deliveryId}:${nonce}:${purpose}`).readUInt32BE(0) % 9000;
  return String(1000 + n);
}

export function hashOtp(deliveryId: string, purpose: OtpPurpose, code: string): string {
  return mac(`hash:${deliveryId}:${purpose}:${code}`).toString("hex");
}

export function otpMatches(deliveryId: string, purpose: OtpPurpose, code: string, expectedHash: string): boolean {
  const a = Buffer.from(hashOtp(deliveryId, purpose, code), "hex");
  const b = Buffer.from(expectedHash, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}
