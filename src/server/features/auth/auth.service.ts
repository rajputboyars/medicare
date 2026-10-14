import bcrypt from "bcryptjs";
import { signPurposeToken, verifyPurposeToken } from "@/lib/auth";
import { DEFAULT_PREFERENCES, type Language, type Session, type User } from "@/lib/types";
import { isLang } from "@/i18n/languages";
import { ApiError, badRequest, conflict, forbidden, unauthenticated } from "../../errors";
import { audit, db, uid } from "../../store";
import { track } from "../../analytics";
import { coverageForLocation, registerInterest, resolveLocation } from "../service-areas/service-areas.service";
import { LOGIN, MFA_TOKEN_TTL_S, SIGNUP_TOKEN_TTL_S, adminMfaRequired } from "./config";
import { issueOtp, verifyOtp } from "./otp.service";
import { createSession, grantElevation, type RequestMeta } from "./session.service";

/**
 * Sign-in flows.
 *
 *  Customers and partners   mobile → one-time code → (new person: name, language, location) → session. No password.
 *  Staff and admins         identifier + password (with lock-out) → admin: second factor → session.
 *  Admins, sensitive acts   re-confirm password → a few minutes of "elevated" access.
 *
 * Messages never reveal whether a mobile number or email has an account.
 */

const DUMMY_HASH = "$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidinval";

export interface IssuedSession { session: Session; token: string; expiresAt: Date; user: User }

// ───────────── Mobile one-time code ─────────────

/** Step 1. The caller must hand `code` to the OTP provider and must never put it in a response (except dev mock). */
export function requestAuthOtp(mobile: string, meta: RequestMeta) {
  const { challenge, code } = issueOtp({ mobile, purpose: "AUTH", ip: meta.ip });
  track("otp_requested", {}, {});
  return { challengeId: challenge.id, code, expiresAt: challenge.expiresAt };
}

export type VerifyOutcome =
  | { kind: "SESSION"; issued: IssuedSession; isNewUser: false }
  | { kind: "SIGNUP"; signupToken: string; isNewUser: true };

/** Step 2. A known mobile signs in. An unknown one gets a short-lived token to finish a minimal profile. */
export async function verifyAuthOtp(input: { challengeId: string; code: string }, meta: RequestMeta): Promise<VerifyOutcome> {
  const c = verifyOtp({ challengeId: input.challengeId, code: input.code, purpose: "AUTH" });
  const d = db();
  const user = d.users.find((u) => u.mobile === c.mobile);
  track("otp_verified", { userId: user?.id }, { existing: !!user });
  if (!user) return { kind: "SIGNUP", isNewUser: true, signupToken: await signPurposeToken("signup", { mobile: c.mobile }, SIGNUP_TOKEN_TTL_S) };
  if (user.status === "SUSPENDED") throw forbidden("This account is suspended. Please contact support.");
  // Admins never sign in with a mobile code alone: password and a second factor are required.
  if (user.role === "SUPER_ADMIN") throw forbidden("Please use the staff login.");
  user.mobileVerifiedAt = new Date().toISOString();
  return { kind: "SESSION", isNewUser: false, issued: { user, ...(await createSession(user, meta, { mfaVerified: true })) } };
}

export interface SignupInput { signupToken: string; name: string; language: Language; pincode: string; acceptTerms: true }

export type SignupOutcome =
  | { status: "CREATED"; issued: IssuedSession; district?: string }
  | { status: "UNAVAILABLE"; message: string; interestSaved: true };

/**
 * Step 3 + 4: the minimal profile and the location. Only name, language and pincode are collected (the mobile is already
 * verified). If we do not deliver there yet, no account is made: the number is saved as an interest and the person is told.
 */
export async function completeSignup(input: SignupInput, meta: RequestMeta): Promise<SignupOutcome> {
  const claims = await verifyPurposeToken(input.signupToken, "signup");
  if (!claims?.mobile) throw new ApiError(401, "Please verify your mobile number again.", undefined, "SIGNUP_EXPIRED");
  if (!isLang(input.language)) throw badRequest("Choose a language from the list");
  const d = db();
  if (d.users.some((u) => u.mobile === claims.mobile)) throw conflict("This mobile number is already registered. Please log in.");

  const place = resolveLocation({ pincode: input.pincode });
  track("location_selected", {}, { covered: place.coverage.available });
  if (!place.coverage.available) {
    registerInterest({ mobile: claims.mobile, pincode: input.pincode });
    return { status: "UNAVAILABLE", interestSaved: true, message: place.coverage.message ?? "We're not available in your area yet." };
  }

  const now = new Date().toISOString();
  const user: User = {
    id: uid("u"), name: input.name, mobile: claims.mobile, role: "CUSTOMER", language: input.language,
    pincode: place.pincode, district: place.district, preferences: { ...DEFAULT_PREFERENCES },
    consent: { healthData: false, marketing: false, acceptedAt: now }, status: "ACTIVE", mobileVerifiedAt: now, createdAt: now,
  };
  d.users.push(user);
  d.familyMembers.push({ id: uid("fm"), userId: user.id, name: user.name, age: 30, gender: "OTHER", relationship: "SELF", currentMedicines: [] });
  track("signup_completed", { userId: user.id }, { language: user.language });
  return { status: "CREATED", district: place.district, issued: { user, ...(await createSession(user, meta, { mfaVerified: true })) } };
}

// ───────────── Password sign-in (staff, admins) ─────────────

function findByIdentifier(identifier: string): User | undefined {
  const id = identifier.trim().toLowerCase();
  return db().users.find((x) => x.mobile === id || x.email?.toLowerCase() === id);
}

/** Checks a password with lock-out. Same message for unknown account, wrong password and locked account. */
function checkPassword(user: User | undefined, password: string): User {
  const generic = badRequest("Mobile/email or password is not correct");
  const now = Date.now();
  if (user?.lockedUntil && Date.parse(user.lockedUntil) > now) {
    bcrypt.compareSync(password, DUMMY_HASH); // keep the timing similar
    throw new ApiError(429, "Too many wrong passwords. Please wait a few minutes and try again.", undefined, "ACCOUNT_LOCKED");
  }
  const ok = bcrypt.compareSync(password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !user.passwordHash || !ok) {
    if (user) {
      user.failedLogins = (user.failedLogins ?? 0) + 1;
      if (user.failedLogins >= LOGIN.maxFailures) {
        user.lockedUntil = new Date(now + LOGIN.lockMs).toISOString();
        user.failedLogins = 0;
        audit({ id: user.id, role: user.role }, "ACCOUNT_LOCKED", "User", user.id);
      }
    }
    throw generic;
  }
  user.failedLogins = 0;
  user.lockedUntil = undefined;
  if (user.status === "SUSPENDED") throw forbidden("This account is suspended. Please contact support.");
  return user;
}

export type PasswordOutcome =
  | { kind: "SESSION"; issued: IssuedSession }
  | { kind: "MFA_REQUIRED"; mfaToken: string; challengeId: string; code: string; mobile: string; mobileHint: string };

export async function passwordLogin(input: { identifier: string; password: string }, meta: RequestMeta): Promise<PasswordOutcome> {
  const user = checkPassword(findByIdentifier(input.identifier), input.password);
  if (user.role === "SUPER_ADMIN" && (adminMfaRequired() || user.mfa?.enabled)) {
    // Second factor: a one-time code to the admin's own mobile (TOTP can replace this behind the same two endpoints).
    const { challenge, code } = issueOtp({ mobile: user.mobile, purpose: "ADMIN_MFA", subjectId: user.id, ip: meta.ip });
    const mfaToken = await signPurposeToken("mfa", { uid: user.id, cid: challenge.id }, MFA_TOKEN_TTL_S);
    return { kind: "MFA_REQUIRED", mfaToken, challengeId: challenge.id, code, mobile: user.mobile, mobileHint: `${user.mobile.slice(0, 2)}******${user.mobile.slice(-2)}` };
  }
  return { kind: "SESSION", issued: { user, ...(await createSession(user, meta, { mfaVerified: user.role !== "SUPER_ADMIN" })) } };
}

/** Admin sign-in, second step. */
export async function verifyAdminMfa(input: { mfaToken: string; code: string }, meta: RequestMeta): Promise<IssuedSession> {
  const claims = await verifyPurposeToken(input.mfaToken, "mfa");
  const user = claims && db().users.find((u) => u.id === claims.uid);
  if (!claims || !user || user.role !== "SUPER_ADMIN") throw new ApiError(401, "Please log in again.", undefined, "MFA_EXPIRED");
  verifyOtp({ challengeId: claims.cid, code: input.code, purpose: "ADMIN_MFA", mobile: user.mobile, subjectId: user.id });
  if (user.status === "SUSPENDED") throw forbidden("This account is suspended.");
  audit({ id: user.id, role: user.role }, "ADMIN_LOGIN", "User", user.id, { ip: meta.ip });
  return { user, ...(await createSession(user, meta, { mfaVerified: true })) };
}

/** Admin re-confirms identity before sensitive actions (approvals, settings, settlements, suspensions). */
export function elevateSession(actor: { id: string; role: User["role"]; sessionId?: string }, password: string): string {
  if (actor.role !== "SUPER_ADMIN" || !actor.sessionId) throw forbidden();
  const user = db().users.find((u) => u.id === actor.id);
  checkPassword(user, password);
  return grantElevation(actor.sessionId, { id: actor.id, name: user!.name, role: actor.role });
}

export function requireSessionUser(user: User | undefined): User {
  if (!user) throw unauthenticated();
  return user;
}

/** Keep the "where are they" hint in sync when a customer changes area later. */
export function setHomeArea(userId: string, pincode: string) {
  const u = db().users.find((x) => x.id === userId);
  if (!u) return;
  const r = resolveLocation({ pincode });
  u.pincode = pincode;
  u.district = r.district;
  track("location_selected", { userId }, { covered: coverageForLocation({ pincode, district: r.district }).available });
}
