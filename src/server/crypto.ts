import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Keyed hashing for one-time codes. Codes are short, so a plain hash could be reversed by trying every number;
 * a keyed hash (HMAC with a server-only secret) cannot be, even if the database is copied.
 */
export function secretKey(): string {
  const s = process.env.OTP_SECRET ?? process.env.AUTH_SECRET;
  if (!s || s.length < 32) {
    if (process.env.NODE_ENV === "production") throw new Error("OTP_SECRET or AUTH_SECRET must be set (>= 32 chars) in production");
    return "dev-only-otp-secret-change-me-0123456789abcdef";
  }
  return s;
}

export const hmacHex = (data: string) => createHmac("sha256", secretKey()).update(data).digest("hex");
export const randomDigits = (n: number) => Array.from(randomBytes(n), (b) => b % 10).join("");

export function safeEqualHex(a: string, b: string): boolean {
  const x = Buffer.from(a, "hex"), y = Buffer.from(b, "hex");
  return x.length === y.length && timingSafeEqual(x, y);
}
