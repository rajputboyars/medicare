import type { OtpChallenge, OtpPurpose } from "@/lib/types";
import { rateLimiter } from "@/lib/rate-limit";
import { ApiError, badRequest } from "../../errors";
import { hmacHex, randomDigits, safeEqualHex } from "../../crypto";
import { db, uid } from "../../store";
import { OTP } from "./config";

/**
 * One-time codes for sign-in, admin MFA and customer consent.
 *
 *  - 6 digits, random, valid for 5 minutes, one use.
 *  - Only a keyed hash is stored. The code itself exists only in the message that was sent.
 *  - Brute force: 5 wrong tries destroy the code; a mobile that keeps failing is blocked for the rest of the hour;
 *    requesting a new code invalidates the previous one, so tries cannot be multiplied.
 *  - Asking for codes is throttled per mobile (cooldown + per hour). The HTTP layer adds a per-IP limit on top.
 *  - Messages are the same whether or not the mobile has an account.
 */

const hashFor = (challengeId: string, mobile: string, code: string) => hmacHex(`otp:${challengeId}:${mobile}:${code}`);
const tooMany = (sec: number) => new ApiError(429, `Too many attempts. Please try again in ${Math.max(1, Math.ceil(sec))} seconds.`, undefined, "RATE_LIMITED");

/** Creates a challenge and returns the plain code ONCE, for the provider to send. Nothing readable is stored. */
export function issueOtp(input: { mobile: string; purpose: OtpPurpose; subjectId?: string; ip?: string }): { challenge: OtpChallenge; code: string } {
  const d = db();
  const now = Date.now();
  const mine = d.otpChallenges.filter((c) => c.mobile === input.mobile && c.purpose === input.purpose);

  const last = mine.reduce((m, c) => Math.max(m, Date.parse(c.createdAt)), 0);
  if (last && now - last < OTP.resendCooldownMs) throw tooMany((OTP.resendCooldownMs - (now - last)) / 1000);
  const lastHour = mine.filter((c) => now - Date.parse(c.createdAt) < 3600_000).length;
  if (lastHour >= OTP.maxPerMobilePerHour) throw tooMany(3600 - (now - Math.min(...mine.map((c) => Date.parse(c.createdAt)))) / 1000);

  // Only the newest code works
  for (const c of mine) if (!c.consumedAt && !c.invalidatedAt) c.invalidatedAt = new Date(now).toISOString();

  const id = uid("otp");
  const code = randomDigits(OTP.length);
  const challenge: OtpChallenge = {
    id, mobile: input.mobile, purpose: input.purpose, codeHash: hashFor(id, input.mobile, code), attempts: 0, maxAttempts: OTP.maxAttempts,
    expiresAt: new Date(now + OTP.ttlMs).toISOString(), subjectId: input.subjectId, ip: input.ip, createdAt: new Date(now).toISOString(),
  };
  d.otpChallenges.push(challenge);
  return { challenge, code };
}

export type OtpFailure = "INVALID" | "EXPIRED" | "USED" | "LOCKED";

/**
 * Checks a code. On success the challenge is consumed (cannot be replayed).
 * Every failure looks the same to the caller ("code is not correct or has expired") except that the HTTP status is 429 when locked.
 */
export function verifyOtp(input: { challengeId: string; code: string; purpose: OtpPurpose; mobile?: string; subjectId?: string }): OtpChallenge {
  const d = db();
  const now = Date.now();
  const generic = badRequest("That code is not correct or has expired. Please request a new one.");
  const c = d.otpChallenges.find((x) => x.id === input.challengeId);
  if (!c || c.purpose !== input.purpose || (input.mobile && c.mobile !== input.mobile) || (input.subjectId && c.subjectId !== input.subjectId)) throw generic;

  // A mobile that keeps guessing is blocked for the rest of the hour, whatever codes it asks for
  const failKey = `otp-fail:${c.mobile}`;
  if (rateLimiter.peek?.(failKey, OTP.maxFailuresPerMobilePerHour)) throw tooMany(3600);

  if (c.consumedAt || c.invalidatedAt || Date.parse(c.expiresAt) <= now || c.attempts >= c.maxAttempts) throw generic;

  c.attempts += 1;
  const ok = /^\d+$/.test(input.code) && input.code.length === OTP.length && safeEqualHex(hashFor(c.id, c.mobile, input.code), c.codeHash);
  if (!ok) {
    rateLimiter.hit(failKey, OTP.maxFailuresPerMobilePerHour, 3600_000);
    if (c.attempts >= c.maxAttempts) c.invalidatedAt = new Date(now).toISOString(); // the code is destroyed
    throw generic;
  }
  c.consumedAt = new Date(now).toISOString();
  return c;
}

/** Housekeeping: finished challenges older than a day are deleted (they hold only hashes, but there is no reason to keep them). */
export function purgeOtpChallenges(at = Date.now()): number {
  const d = db();
  const before = d.otpChallenges.length;
  d.otpChallenges = d.otpChallenges.filter((c) => at - Date.parse(c.expiresAt) < 24 * 3600_000);
  return before - d.otpChallenges.length;
}
