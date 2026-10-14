import type { NextResponse } from "next/server";
import { SESSION_COOKIE, cookieOptions } from "@/lib/auth";
import { homeFor } from "@/lib/rbac";
import { ApiError } from "../../errors";
import { publicUser } from "../accounts/accounts.service";
import { OTP } from "./config";
import { OtpProviderUnavailable, devOtpExposed, otpProvider } from "./otp-provider";
import type { IssuedSession } from "./auth.service";
import type { OtpPurpose } from "@/lib/types";

/** Sends a code through the configured provider. Fails closed: no provider, no code. */
export async function dispatchOtp(mobile: string, code: string, purpose: OtpPurpose) {
  try {
    await otpProvider().send({ mobile, code, purpose, ttlMinutes: Math.round(OTP.ttlMs / 60_000) });
  } catch (e) {
    if (e instanceof OtpProviderUnavailable) throw new ApiError(503, "We cannot send codes right now. Please try again later.", undefined, "OTP_UNAVAILABLE");
    console.error("[otp] provider failed", (e as Error).message);
    throw new ApiError(502, "We could not send the code. Please try again.", undefined, "OTP_SEND_FAILED");
  }
}

/** The extra field a developer sees with the mock provider. In production this is ALWAYS an empty object. */
export const devOtpField = (code: string): { devOtp?: string } => (devOtpExposed() ? { devOtp: code } : {});

export function setSessionCookie(res: NextResponse, token: string, expiresAt: Date) {
  res.cookies.set(SESSION_COOKIE, token, cookieOptions(expiresAt));
}
export const clearSessionCookie = (res: NextResponse) => res.cookies.set(SESSION_COOKIE, "", { path: "/", maxAge: 0 });

export const sessionPayload = (issued: IssuedSession) => ({ user: publicUser(issued.user), redirect: homeFor(issued.user.role), expiresAt: issued.expiresAt.toISOString() });
