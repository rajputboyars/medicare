/** Every tunable number for sign-in in one place. Times are in milliseconds unless the name says otherwise. */
const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR;

export const OTP = {
  length: 6,
  ttlMs: 5 * MIN,
  /** Wrong tries allowed per code. The code is destroyed after this many. */
  maxAttempts: 5,
  /** A new code cannot be requested sooner than this */
  resendCooldownMs: 30_000,
  /** Codes one mobile number may receive per hour */
  maxPerMobilePerHour: 5,
  /** Wrong code entries per mobile per hour across all codes before it is blocked for a while */
  maxFailuresPerMobilePerHour: 12,
} as const;

/** How long each kind of session lives. `idle` moves forward with use; `absolute` is a hard stop. */
export const SESSION_TTL = {
  CUSTOMER: { idle: 30 * DAY, absolute: 90 * DAY },
  PARTNER: { idle: 7 * DAY, absolute: 30 * DAY },
  ADMIN: { idle: 30 * MIN, absolute: 8 * HOUR },
} as const;

export const LOGIN = { maxFailures: 5, lockMs: 15 * MIN } as const;
/** After an admin re-confirms their password, sensitive actions work for this long */
export const ELEVATION_MS = 10 * MIN;
export const SIGNUP_TOKEN_TTL_S = 15 * 60;
export const MFA_TOKEN_TTL_S = 5 * 60;
/** Touching `lastSeenAt` on every request would write constantly; this is the resolution */
export const TOUCH_EVERY_MS = 5 * MIN;

export const isProduction = () => process.env.NODE_ENV === "production";
/** Admin sign-in always needs a second factor in production; in development it is optional per account. */
export const adminMfaRequired = () => (process.env.ADMIN_MFA ?? (isProduction() ? "required" : "optional")) === "required";
