import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { rateLimiter } from "@/lib/rate-limit";
import { MED } from "@/server/seed";
import { db, resetDb } from "@/server/store";
import { devOutbox, devOtpExposed, otpProvider } from "@/server/features/auth/otp-provider";
import { issueOtp, verifyOtp } from "@/server/features/auth/otp.service";
import { OTP } from "@/server/features/auth/config";
import { call, jar, route, signIn } from "./helpers/http";
import { ANALYTICS_EVENTS, registerAnalyticsSink, unregisterAnalyticsSink, type AnalyticsSink } from "@/server/analytics";

vi.mock("next/headers", async () => await import("./helpers/next-headers"));

const MOBILE = "9000000101";

beforeEach(() => { resetDb(); rateLimiter.reset?.(); devOutbox.clear(); jar.token = undefined; jar.headers = {}; vi.useRealTimers(); });
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });

async function requestCode(mobile = MOBILE) {
  const r = await call((await route("auth/otp/request")).POST, "POST", "/api/auth/otp/request", { body: { mobile } });
  return r;
}
async function verify(challengeId: string, code: string) {
  return call((await route("auth/otp/verify")).POST, "POST", "/api/auth/otp/verify", { body: { challengeId, code } });
}
const wrongCode = (real: string) => (real === "000000" ? "111111" : "000000");

describe("OTP: request, expiry, invalid codes, brute force", () => {
  it("sends a 6-digit code through the provider and never stores it", async () => {
    const r = await requestCode();
    expect(r.status).toBe(200);
    const code = devOutbox.last(MOBILE)!;
    expect(code).toMatch(/^\d{6}$/);
    const stored = db().otpChallenges[0];
    expect(stored.codeHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(db().otpChallenges)).not.toContain(code); // no plain code anywhere in the data
    expect(stored.expiresAt > new Date().toISOString()).toBe(true);
  });
  it("does not reveal whether a number has an account", async () => {
    const known = await requestCode("9876543210");
    const unknown = await requestCode(MOBILE);
    expect(Object.keys(known.body.data).sort()).toEqual(Object.keys(unknown.body.data).sort());
    expect(known.body.message).toBe(unknown.body.message);
  });
  it("accepts the right code once; the same code cannot be replayed", async () => {
    const { body } = await requestCode();
    const code = devOutbox.last(MOBILE)!;
    expect((await verify(body.data.challengeId, code)).status).toBe(200);
    expect((await verify(body.data.challengeId, code)).status).toBe(400);
  });
  it("a code expires after 5 minutes", async () => {
    vi.useFakeTimers();
    const { body } = await requestCode();
    const code = devOutbox.last(MOBILE)!;
    vi.advanceTimersByTime(OTP.ttlMs - 1000);
    // still valid just before expiry, so check on a fresh challenge instead of consuming this one
    vi.advanceTimersByTime(2000);
    const r = await verify(body.data.challengeId, code);
    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(/not correct or has expired/);
  });
  it("a wrong code is refused with the same message as an expired one", async () => {
    const { body } = await requestCode();
    const r = await verify(body.data.challengeId, wrongCode(devOutbox.last(MOBILE)!));
    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(/not correct or has expired/);
    expect((await verify("otp_nonexistent", "123456")).body.message).toBe(r.body.message);
    expect((await call((await route("auth/otp/verify")).POST, "POST", "/x", { body: { challengeId: body.data.challengeId, code: "12" } })).status).toBe(400); // malformed
  });
  it("brute force: 5 wrong tries destroy the code, even the right one then fails", async () => {
    const { body } = await requestCode();
    const real = devOutbox.last(MOBILE)!;
    for (let i = 0; i < OTP.maxAttempts; i++) expect((await verify(body.data.challengeId, wrongCode(real))).status).toBe(400);
    expect(db().otpChallenges[0].invalidatedAt).toBeTruthy();
    expect((await verify(body.data.challengeId, real)).status).toBe(400);
    expect(db().users.some((u) => u.mobile === MOBILE)).toBe(false);
  });
  it("asking for a new code cancels the old one, so tries cannot be multiplied", () => {
    const first = issueOtp({ mobile: MOBILE, purpose: "AUTH" });
    vi.useFakeTimers({ now: Date.now() + 60_000 });
    const second = issueOtp({ mobile: MOBILE, purpose: "AUTH" });
    expect(() => verifyOtp({ challengeId: first.challenge.id, code: first.code, purpose: "AUTH" })).toThrow();
    expect(verifyOtp({ challengeId: second.challenge.id, code: second.code, purpose: "AUTH" }).consumedAt).toBeTruthy();
  });
  it("a mobile that keeps guessing across many codes is blocked for the hour", () => {
    vi.useFakeTimers({ now: 1_800_000_000_000 });
    let blocked = false;
    for (let round = 0; round < 6 && !blocked; round++) {
      vi.advanceTimersByTime(31_000);
      const { challenge } = issueOtp({ mobile: MOBILE, purpose: "AUTH" });
      for (let i = 0; i < OTP.maxAttempts; i++) {
        try { verifyOtp({ challengeId: challenge.id, code: "000000", purpose: "AUTH" }); } catch (e) { if ((e as { status: number }).status === 429) blocked = true; }
      }
    }
    expect(blocked).toBe(true);
  });
  it("resend cooldown and an hourly cap per mobile", async () => {
    expect((await requestCode()).status).toBe(200);
    const tooSoon = await requestCode();
    expect(tooSoon.status).toBe(429);
    expect(tooSoon.body.errors?.[0].code).toBe("RATE_LIMITED");
    vi.useFakeTimers({ now: Date.now() });
    let last = 200;
    for (let i = 0; i < OTP.maxPerMobilePerHour + 1; i++) { vi.advanceTimersByTime(31_000); last = (await requestCode()).status; }
    expect(last).toBe(429);
  });
  it("is throttled per IP as well, so one machine cannot spray many numbers", async () => {
    let status = 200;
    for (let i = 0; i < 25; i++) status = (await call((await route("auth/otp/request")).POST, "POST", "/x", { body: { mobile: `90000002${String(i).padStart(2, "0")}` } })).status;
    expect(status).toBe(429);
  });
  it("codes are bound to their purpose and mobile", () => {
    const { challenge, code } = issueOtp({ mobile: MOBILE, purpose: "AUTH" });
    expect(() => verifyOtp({ challengeId: challenge.id, code, purpose: "ADMIN_MFA" })).toThrow();
    expect(() => verifyOtp({ challengeId: challenge.id, code, purpose: "AUTH", mobile: "9000000999" })).toThrow();
  });
});

describe("OTP provider: development vs production", () => {
  it("development: the mock provider works and the code is shown to the developer", async () => {
    expect(otpProvider().name).toBe("mock");
    expect(devOtpExposed()).toBe(true);
    const r = await requestCode();
    expect(r.body.data.devOtp).toBe(devOutbox.last(MOBILE));
  });
  it("production: no code in any response, and the mock provider is refused", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AUTH_SECRET", "a-long-production-secret-for-tests-0123456789");
    vi.stubEnv("OTP_PROVIDER", "mock");
    expect(devOtpExposed()).toBe(false);
    expect(() => otpProvider()).toThrow(/not allowed in production/);
    const r = await requestCode();
    expect(r.status).toBe(503); // fails closed rather than pretending
    expect(JSON.stringify(r.body)).not.toMatch(/devOtp|\d{6}/);
  });
  it("production with no provider configured fails closed; with a real provider it still never returns the code", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("OTP_PROVIDER", "");
    expect(() => otpProvider()).toThrow(/No OTP provider/);
    vi.stubEnv("OTP_PROVIDER", "msg91");
    expect(devOtpExposed()).toBe(false);
    expect(otpProvider().name).toBe("msg91");
  });
  it("a non-mock provider in development also hides the code", () => {
    vi.stubEnv("OTP_PROVIDER", "msg91");
    expect(devOtpExposed()).toBe(false);
  });
});

describe("customer signup: mobile → code → minimal profile → location", () => {
  async function verified() {
    const { body } = await requestCode();
    const v = await verify(body.data.challengeId, devOutbox.last(MOBILE)!);
    return v.body.data as { isNewUser: boolean; signupToken: string };
  }
  const profile = { name: "Meena Devi", language: "hi", pincode: "261001", acceptTerms: true };

  it("a new number gets a short-lived token, not an account or a session", async () => {
    const v = await verified();
    expect(v.isNewUser).toBe(true);
    expect(v.signupToken.length).toBeGreaterThan(20);
    expect(db().users.some((u) => u.mobile === MOBILE)).toBe(false);
    expect(jar.token).toBeUndefined();
  });
  it("creates the account with ONLY name, mobile, language and pincode, no password and no medical data", async () => {
    const v = await verified();
    const reg = await call((await route("auth/register")).POST, "POST", "/api/auth/register", { body: { signupToken: v.signupToken, ...profile } });
    expect(reg.status).toBe(201);
    expect(reg.body.data.status).toBe("CREATED");
    expect(reg.headers.get("set-cookie")).toMatch(/mc_session=.+HttpOnly/i);
    const u = db().users.find((x) => x.mobile === MOBILE)!;
    expect(u).toMatchObject({ name: "Meena Devi", language: "hi", pincode: "261001", role: "CUSTOMER", status: "ACTIVE" });
    expect(u.passwordHash).toBeUndefined();
    expect(u.consent.healthData).toBe(false);
    expect(db().familyMembers.filter((f) => f.userId === u.id)).toHaveLength(1);
    expect(JSON.stringify(reg.body)).not.toMatch(/passwordHash|codeHash/);
  });
  it("the same token cannot create a second account, and a forged or tampered token is refused", async () => {
    const v = await verified();
    const reg = (token: string, extra = {}) => call((await_route_register()), "POST", "/x", { body: { signupToken: token, ...profile, ...extra } });
    function await_route_register() { return registerHandler; }
    const registerHandler = (await route("auth/register")).POST;
    expect((await reg(v.signupToken)).status).toBe(201);
    expect((await reg(v.signupToken)).status).toBe(409);
    expect((await reg("x".repeat(60))).status).toBe(401);
    expect((await reg(v.signupToken.slice(0, -3) + "abc")).status).toBe(401);
  });
  it("a signup cannot choose its role or send medical details", async () => {
    const v = await verified();
    const h = (await route("auth/register")).POST;
    expect((await call(h, "POST", "/x", { body: { signupToken: v.signupToken, ...profile, role: "SUPER_ADMIN" } })).status).toBe(400);
    expect((await call(h, "POST", "/x", { body: { signupToken: v.signupToken, ...profile, allergies: "penicillin" } })).status).toBe(400);
    expect((await call(h, "POST", "/x", { body: { signupToken: v.signupToken, ...profile, language: "zz" } })).status).toBe(400);
    expect((await call(h, "POST", "/x", { body: { signupToken: v.signupToken, ...profile, acceptTerms: false } })).status).toBe(400);
    expect(db().users.some((u) => u.mobile === MOBILE)).toBe(false);
  });
  it("an existing customer signs in with the code and is NOT asked for a profile", async () => {
    const { body } = await requestCode("9876543210");
    const v = await verify(body.data.challengeId, devOutbox.last("9876543210")!);
    expect(v.status).toBe(200);
    expect(v.body.data).toMatchObject({ isNewUser: false, user: { name: "Asha Verma", role: "CUSTOMER" } });
    expect(v.headers.get("set-cookie")).toMatch(/mc_session=/);
  });
  it("an admin cannot sign in with a mobile code alone", async () => {
    const { body } = await requestCode("9800000001");
    const v = await verify(body.data.challengeId, devOutbox.last("9800000001")!);
    expect(v.status).toBe(403);
    expect(v.headers.get("set-cookie")).toBeNull();
  });
  it("a suspended account cannot sign in", async () => {
    db().users.find((u) => u.mobile === "9876543210")!.status = "SUSPENDED";
    const { body } = await requestCode("9876543210");
    expect((await verify(body.data.challengeId, devOutbox.last("9876543210")!)).status).toBe(403);
  });
});

describe("service area at signup", () => {
  async function token() {
    const { body } = await requestCode();
    return (await verify(body.data.challengeId, devOutbox.last(MOBILE)!)).body.data.signupToken as string;
  }
  const reg = async (signupToken: string, pincode: string) =>
    call((await route("auth/register")).POST, "POST", "/x", { body: { signupToken, name: "Ravi Kumar", language: "en", pincode, acceptTerms: true } });

  it("an unsupported pincode: 'not available yet', no account, and the interest is saved", async () => {
    const r = await reg(await token(), "110001");
    expect(r.status).toBe(200);
    expect(r.body.message).toBe("We're coming to your area. We can't deliver here yet.");
    expect(r.body.data).toMatchObject({ status: "UNAVAILABLE", interestSaved: true });
    expect(r.headers.get("set-cookie")).toBeNull();
    expect(db().users.some((u) => u.mobile === MOBILE)).toBe(false);
    expect(db().serviceAreaInterests).toEqual([expect.objectContaining({ mobile: MOBILE, pincode: "110001", createdAt: expect.any(String) })]);
  });
  it("COMING_SOON and DISABLED areas behave the same way", async () => {
    for (const status of ["COMING_SOON", "DISABLED"] as const) {
      resetDb(); rateLimiter.reset?.(); devOutbox.clear();
      db().serviceAreas.find((a) => a.pincode === "261001")!.status = status;
      const r = await reg(await token(), "261001");
      expect(r.body.data.status, status).toBe("UNAVAILABLE");
    }
  });
  it("an active area continues to the platform", async () => {
    const r = await reg(await token(), "261001");
    expect(r.status).toBe(201);
    expect(r.body.data.user.district).toBe("Sitapur");
  });
  it("location lookup by pincode and by GPS, with coverage", async () => {
    const h = (await route("location/resolve")).GET;
    const byPin = await call(h, "GET", "/api/location/resolve?pincode=261001");
    expect(byPin.body.data).toMatchObject({ pincode: "261001", district: "Sitapur", detectedBy: "PINCODE", coverage: { available: true, status: "ACTIVE" } });
    const byGps = await call(h, "GET", "/api/location/resolve?lat=27.5712&lng=80.6878");
    expect(byGps.body.data).toMatchObject({ pincode: "261001", detectedBy: "COORDINATES", coverage: { available: true } });
    const far = await call(h, "GET", "/api/location/resolve?lat=19.07&lng=72.87"); // Mumbai
    expect(far.status).toBe(400);
    const unsupported = await call(h, "GET", "/api/location/resolve?pincode=110001");
    expect(unsupported.body.data.coverage).toMatchObject({ available: false });
    expect((await call(h, "GET", "/api/location/resolve")).status).toBe(400);
  });
  it("'register interest' is public, de-duplicated, validated and throttled", async () => {
    const h = (await route("service-areas/interest")).POST;
    expect((await call(h, "POST", "/x", { body: { mobile: "9000000555", pincode: "110001" } })).status).toBe(201);
    await call(h, "POST", "/x", { body: { mobile: "9000000555", pincode: "110001" } });
    expect(db().serviceAreaInterests.filter((i) => i.mobile === "9000000555")).toHaveLength(1);
    expect((await call(h, "POST", "/x", { body: { mobile: "123", pincode: "110001" } })).status).toBe(400);
    let s = 201;
    for (let i = 0; i < 12; i++) s = (await call(h, "POST", "/x", { body: { mobile: `90000007${String(i).padStart(2, "0")}`, pincode: "110002" } })).status;
    expect(s).toBe(429);
  });
});

describe("guest restrictions and customer route protection", () => {
  const guestGets: [string, string][] = [["cart", "GET"], ["orders", "GET"], ["addresses", "GET"], ["family", "GET"], ["prescriptions", "GET"], ["medicine-requests", "GET"], ["saved", "GET"], ["notifications", "GET"], ["support", "GET"]];
  for (const [path, method] of guestGets) {
    it(`guest cannot use /api/${path}`, async () => {
      const r = await call((await route(path))[method], method, `/api/${path}`);
      expect(r.status).toBe(401);
    });
  }
  it("guest cannot write: cart, addresses, family, orders, requests, prescriptions, quick-order", async () => {
    const posts: [string, unknown][] = [
      ["cart/items", { pharmacyId: "ph_1", medicineId: MED.PARACETAMOL, quantity: 1 }],
      ["addresses", {}], ["family", {}],
      ["orders", { pharmacyId: "ph_1", addressId: "ad_1", paymentMethod: "COD", items: [{ medicineId: MED.PARACETAMOL, quantity: 1 }] }],
      ["medicine-requests", { medicineQuery: "x y", mobile: "9876543210", pincode: "261001" }],
      ["orders/quote", {}],
    ];
    for (const [path, body] of posts) expect((await call((await route(path)).POST, "POST", `/api/${path}`, { body })).status, path).toBe(401);
    const form = new FormData(); form.set("file", new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0])], "a.png", { type: "image/png" })); form.set("consent", "true");
    expect((await (await route("prescriptions")).POST(new Request("http://localhost/x", { method: "POST", body: form }), { params: Promise.resolve({}) })).status).toBe(401);
    expect((await (await route("quick-order")).POST(new Request("http://localhost/x", { method: "POST", body: form }), { params: Promise.resolve({}) })).status).toBe(401);
  });
  it("guest CAN search medicines, see availability, check coverage, read offers and ask for a call-back", async () => {
    expect((await call((await route("medicines/search")).GET, "GET", "/api/medicines/search?pincode=261001&q=para")).status).toBe(200);
    expect((await call((await route("medicines/[id]/availability")).GET, "GET", `/x?pincode=261001`, { params: { id: MED.PARACETAMOL } })).status).toBe(200);
    expect((await call((await route("coverage")).GET, "GET", "/api/coverage?pincode=261001")).status).toBe(200);
    expect((await call((await route("offers")).GET, "GET", "/api/offers")).status).toBe(200);
    expect((await call((await route("support/callback")).POST, "POST", "/x", { body: { mobile: "9000000777", area: "Biswan", reason: "Help me order" } })).status).toBe(201);
  });
  it("the page-level guard redirects guests, but the API is what actually protects", async () => {
    const { proxy } = await import("@/proxy");
    const { NextRequest } = await import("next/server");
    for (const p of ["/orders", "/checkout", "/profile", "/family", "/upload-prescription", "/find-medicine", "/pharmacy", "/delivery", "/admin"]) {
      const res = await proxy(new NextRequest(`http://localhost${p}`));
      expect(res.status, p).toBe(307);
      expect(res.headers.get("location")).toContain("/login");
    }
    expect((await proxy(new NextRequest("http://localhost/medicines"))).status).toBe(200); // guests can browse
  });
});

describe("sessions: logout, refresh, revocation", () => {
  async function login(mobile = "9876543210") {
    const { body } = await requestCode(mobile);
    const r = await verify(body.data.challengeId, devOutbox.last(mobile)!);
    const token = /mc_session=([^;]+)/.exec(r.headers.get("set-cookie") ?? "")![1];
    return token;
  }
  const me = async () => (await call((await route("auth/me")).GET, "GET", "/api/auth/me")).body.data.user;

  it("a real login creates a server-side session; the cookie is HttpOnly + SameSite=Lax", async () => {
    jar.token = await login();
    expect((await me()).name).toBe("Asha Verma");
    expect(db().sessions.filter((s) => s.userId === "u_1" && !s.revokedAt)).toHaveLength(1);
  });
  it("logout revokes the session on the SERVER: replaying the old cookie no longer works", async () => {
    const token = await login();
    jar.token = token;
    const out = await call((await route("auth/logout")).POST, "POST", "/api/auth/logout");
    expect(out.status).toBe(200);
    expect(out.headers.get("set-cookie")).toMatch(/mc_session=;/);
    jar.token = token; // an attacker who copied the cookie earlier
    expect(await me()).toBeNull();
    expect((await call((await route("orders")).GET, "GET", "/api/orders")).status).toBe(401);
    expect(db().sessions.find((s) => s.userId === "u_1")!.revokedReason).toBe("logout");
  });
  it("two devices: logging out of one leaves the other, 'log out everywhere' ends both", async () => {
    const a = await login(); devOutbox.clear(); rateLimiter.reset?.();
    vi.useFakeTimers({ now: Date.now() + 60_000 });
    const b = await login();
    jar.token = a;
    expect((await call((await route("auth/sessions")).GET, "GET", "/x")).body.data).toHaveLength(2);
    await call((await route("auth/logout")).POST, "POST", "/x");
    jar.token = b;
    expect(await me()).not.toBeNull();
    const all = await call((await route("auth/sessions")).DELETE, "DELETE", "/api/auth/sessions?all=1");
    expect(all.body.data.revoked).toBeGreaterThanOrEqual(1);
    expect(await me()).toBeNull();
  });
  it("one device can sign out another, but never someone else's session", async () => {
    const a = await login();
    const other = await signIn("rajesh@example.com");
    jar.token = a;
    const dev = await call((await route("auth/sessions/[id]")).DELETE, "DELETE", "/x", { params: { id: other!.session.id } });
    expect(dev.status).toBe(404);
    expect(db().sessions.find((s) => s.id === other!.session.id)!.revokedAt).toBeUndefined();
  });
  it("an admin revoking a user's sessions signs them out immediately", async () => {
    const victim = await signIn("asha@example.com");
    const victimToken = victim!.token;
    await signIn("admin@example.com");
    const r = await call((await route("admin/users/[id]/revoke-sessions")).POST, "POST", "/x", { params: { id: "u_1" } });
    expect(r.body.data.revoked).toBe(1);
    jar.token = victimToken;
    expect(await me()).toBeNull();
  });
  it("suspending an account revokes its sessions and blocks the next request", async () => {
    const victim = await signIn("asha@example.com");
    await signIn("admin@example.com");
    expect((await call((await route("admin/users/[id]/status")).POST, "POST", "/x", { params: { id: "u_1" }, body: { status: "SUSPENDED" } })).body.data.sessionsRevoked).toBe(1);
    jar.token = victim!.token;
    expect((await call((await route("orders")).GET, "GET", "/x")).status).toBe(401);
  });
  it("sessions expire: idle timeout and the absolute limit", async () => {
    const s = await signIn("asha@example.com");
    const session = db().sessions.find((x) => x.id === s!.session.id)!;
    session.expiresAt = new Date(Date.now() - 1000).toISOString();
    expect(await me()).toBeNull();
    const s2 = await signIn("asha@example.com");
    const sess2 = db().sessions.find((x) => x.id === s2!.session.id)!;
    sess2.absoluteExpiresAt = new Date(Date.now() - 1000).toISOString();
    expect(await me()).toBeNull();
    const refresh = await call((await route("auth/refresh")).POST, "POST", "/x");
    expect(refresh.status).toBe(401);
  });
  it("refresh moves the idle deadline forward and re-issues the cookie, never past the absolute limit", async () => {
    const s = await signIn("asha@example.com");
    const session = db().sessions.find((x) => x.id === s!.session.id)!;
    session.expiresAt = new Date(Date.now() + 60_000).toISOString();
    const r = await call((await route("auth/refresh")).POST, "POST", "/api/auth/refresh");
    expect(r.status).toBe(200);
    expect(r.headers.get("set-cookie")).toMatch(/mc_session=/);
    expect(Date.parse(session.expiresAt)).toBeGreaterThan(Date.now() + 20 * 86400_000);
    expect(Date.parse(session.expiresAt)).toBeLessThanOrEqual(Date.parse(session.absoluteExpiresAt));
  });
  it("a cookie with a forged session id, or one for another user, is refused", async () => {
    const { signSession } = await import("@/lib/auth");
    const forged = await signSession({ id: "u_1", name: "x", role: "CUSTOMER" }, { sessionId: "ses_forged", expiresAt: new Date(Date.now() + 60_000) });
    jar.token = forged;
    expect(await me()).toBeNull();
    const rajesh = await signIn("rajesh@example.com");
    const swapped = await signSession({ id: "u_1", name: "x", role: "CUSTOMER" }, { sessionId: rajesh!.session.id, expiresAt: new Date(Date.now() + 60_000) });
    jar.token = swapped;
    expect(await me()).toBeNull(); // session belongs to u_2, not u_1
  });
  it("cookie name uses the __Host- prefix in production", async () => {
    vi.resetModules();
    vi.stubEnv("NODE_ENV", "production");
    const { SESSION_COOKIE } = await import("@/lib/auth");
    expect(SESSION_COOKIE).toBe("__Host-mc_session");
    vi.unstubAllEnvs();
    vi.resetModules();
  });
});

describe("password login for staff: lock-out and generic errors", () => {
  const login = async (identifier: string, password: string) => call((await route("auth/login")).POST, "POST", "/api/auth/login", { body: { identifier, password } });
  it("the same message for a wrong password and an unknown account", async () => {
    const a = await login("pharmacy@example.com", "Wrong#12345");
    const b = await login("nobody@example.com", "Wrong#12345");
    expect(a.status).toBe(400);
    expect(a.body.message).toBe(b.body.message);
  });
  it("5 wrong passwords lock the account for 15 minutes, even for the right password", async () => {
    for (let i = 0; i < 5; i++) await login("pharmacy@example.com", "Wrong#12345");
    const locked = await login("pharmacy@example.com", "Demo@1234");
    expect(locked.status).toBe(429);
    expect(locked.body.errors?.[0].code).toBe("ACCOUNT_LOCKED");
    vi.useFakeTimers({ now: Date.now() + 16 * 60_000 });
    rateLimiter.reset?.();
    expect((await login("pharmacy@example.com", "Demo@1234")).status).toBe(200);
  });
  it("a password-less account (customers, partners) cannot be logged into with a password", async () => {
    db().users.find((u) => u.mobile === "9876543210")!.passwordHash = undefined;
    expect((await login("9876543210", "Demo@1234")).status).toBe(400);
  });
});

describe("admin: password + second factor + elevated actions", () => {
  const adminLogin = async () => call((await route("auth/login")).POST, "POST", "/api/auth/login", { body: { identifier: "admin@example.com", password: "Demo@1234" } });

  it("with MFA on, the password alone gives NO session; the code from the admin's mobile completes it", async () => {
    db().users.find((u) => u.role === "SUPER_ADMIN")!.mfa = { enabled: true, method: "SMS_OTP" };
    const r = await adminLogin();
    expect(r.body.data.mfaRequired).toBe(true);
    expect(r.headers.get("set-cookie")).toBeNull();
    expect(r.body.data.mobileHint).toMatch(/^98\*+01$/);
    const mfaToken = r.body.data.mfaToken;
    const mfa = (await route("auth/mfa/verify")).POST;
    expect((await call(mfa, "POST", "/x", { body: { mfaToken, code: "000000" } })).status).toBe(400);
    const ok = await call(mfa, "POST", "/x", { body: { mfaToken, code: devOutbox.last("9800000001", "ADMIN_MFA")! } });
    expect(ok.status).toBe(200);
    expect(ok.headers.get("set-cookie")).toMatch(/mc_session=/);
    expect(db().audit.some((a) => a.action === "ADMIN_LOGIN")).toBe(true);
  });
  it("the MFA code is single-use, expires, and a token for another purpose is useless", async () => {
    db().users.find((u) => u.role === "SUPER_ADMIN")!.mfa = { enabled: true, method: "SMS_OTP" };
    const { body } = await adminLogin();
    const code = devOutbox.last("9800000001", "ADMIN_MFA")!;
    const mfa = (await route("auth/mfa/verify")).POST;
    expect((await call(mfa, "POST", "/x", { body: { mfaToken: body.data.mfaToken, code } })).status).toBe(200);
    expect((await call(mfa, "POST", "/x", { body: { mfaToken: body.data.mfaToken, code } })).status).toBe(400);
    const reg = await requestCode(); // an AUTH signup token cannot be used as an MFA token
    const signup = (await verify(reg.body.data.challengeId, devOutbox.last(MOBILE)!)).body.data.signupToken;
    expect((await call(mfa, "POST", "/x", { body: { mfaToken: signup, code } })).status).toBe(401);
  });
  it("in production, MFA is mandatory for admins even if the account never enabled it; the code is never in the response", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("OTP_PROVIDER", "msg91");
    const { adminMfaRequired } = await import("@/server/features/auth/config");
    expect(adminMfaRequired()).toBe(true);
  });
  it("sensitive actions need a recent password confirmation; then they work", async () => {
    await signIn("admin@example.com", { elevate: false });
    const review = (await route("admin/applications/[id]/review")).POST;
    const first = await call(review, "POST", "/x", { params: { id: "app_1" }, body: { action: "START_REVIEW" } });
    expect(first.status).toBe(403);
    expect(first.body.errors?.[0].code).toBe("ELEVATION_REQUIRED");
    const el = (await route("auth/elevate")).POST;
    expect((await call(el, "POST", "/x", { body: { password: "wrong-password" } })).status).toBe(400);
    expect((await call(el, "POST", "/x", { body: { password: "Demo@1234" } })).status).toBe(200);
    expect((await call(review, "POST", "/x", { params: { id: "app_1" }, body: { action: "START_REVIEW" } })).status).toBe(200);
  });
  it("elevation expires after 10 minutes", async () => {
    await signIn("admin@example.com");
    const review = (await route("admin/applications/[id]/review")).POST;
    vi.useFakeTimers({ now: Date.now() + 11 * 60_000 });
    expect((await call(review, "POST", "/x", { params: { id: "app_1" }, body: { action: "START_REVIEW" } })).body.errors?.[0].code).toBe("ELEVATION_REQUIRED");
  });
  it("every sensitive admin route demands elevation", async () => {
    await signIn("admin@example.com", { elevate: false });
    const sensitive: [string, string, Record<string, string> | undefined, unknown][] = [
      ["admin/pharmacies/[id]/verify", "POST", { id: "ph_5" }, { status: "VERIFIED" }],
      ["admin/partners/[kind]/[id]", "PATCH", { kind: "pharmacies", id: "ph_5" }, { status: "VERIFIED" }],
      ["admin/settings", "PATCH", undefined, { commissionPercent: 9 }],
      ["admin/settlements", "POST", undefined, {}],
      ["admin/service-areas", "POST", undefined, { level: "PINCODE", name: "261999", state: "UP", pincode: "261999" }],
      ["admin/users/[id]/status", "POST", { id: "u_1" }, { status: "SUSPENDED" }],
      ["admin/users/[id]/revoke-sessions", "POST", { id: "u_1" }, undefined],
    ];
    for (const [path, method, params, body] of sensitive) {
      const r = await call((await route(path))[method], method, "/x", { params, body });
      expect(r.status, path).toBe(403);
      expect(r.body.errors?.[0].code, path).toBe("ELEVATION_REQUIRED");
    }
  });
  it("non-admins can never elevate or reach admin routes, whatever they do", async () => {
    for (const who of ["asha@example.com", "pharmacy@example.com", "rider@example.com"]) {
      await signIn(who);
      expect((await call((await route("auth/elevate")).POST, "POST", "/x", { body: { password: "Demo@1234" } })).status, who).toBe(403);
      expect((await call((await route("admin/applications")).GET, "GET", "/x")).status, who).toBe(403);
    }
  });
  it("admin sessions are short (30 min idle, 8 h absolute)", async () => {
    const s = await signIn("admin@example.com");
    const t = (x: string) => Date.parse(x) - Date.parse(s!.session.createdAt);
    expect(t(s!.session.expiresAt)).toBe(30 * 60_000);
    expect(t(s!.session.absoluteExpiresAt)).toBe(8 * 3600_000);
  });
});

describe("CSRF: state-changing requests must come from our own origin", () => {
  it("a cross-site Origin is refused; our own origin and requests without one are fine", async () => {
    await signIn("asha@example.com");
    const h = (await route("auth/logout")).POST;
    const attack = await h(new Request("http://localhost/api/auth/logout", { method: "POST", headers: { origin: "https://evil.example", host: "localhost" } }), { params: Promise.resolve({}) });
    expect(attack.status).toBe(403);
    const orders = (await route("orders")).POST;
    const evil = await call(orders, "POST", "/api/orders", { body: { pharmacyId: "ph_1", addressId: "ad_1", paymentMethod: "COD", items: [{ medicineId: MED.PARACETAMOL, quantity: 1 }] }, headers: { origin: "https://evil.example", host: "localhost" } });
    expect(evil.status).toBe(403);
    expect(evil.body.errors?.[0].code).toBe("CSRF_BLOCKED");
    const own = await call(orders, "POST", "/api/orders", { body: { pharmacyId: "ph_1", addressId: "ad_1", paymentMethod: "COD", items: [{ medicineId: MED.PARACETAMOL, quantity: 1 }] }, headers: { origin: "http://localhost", host: "localhost" } });
    expect(own.status).toBe(201);
  });
  it("GET requests are not origin-checked (they change nothing)", async () => {
    await signIn("asha@example.com");
    expect((await call((await route("orders")).GET, "GET", "/api/orders", { headers: { origin: "https://evil.example" } })).status).toBe(200);
  });
});

describe("analytics: vendor-neutral, no personal data", () => {
  it("every sink receives events; a failing sink does not break the request", async () => {
    const seen: string[] = [];
    const good: AnalyticsSink = { name: "t-good", handle: (e) => { seen.push(e.name); } };
    const bad: AnalyticsSink = { name: "t-bad", handle: () => { throw new Error("vendor down"); } };
    registerAnalyticsSink(bad); registerAnalyticsSink(good);
    try {
      const { body } = await requestCode();
      expect(body.data.challengeId).toBeTruthy();
      expect(seen).toContain("otp_requested");
    } finally { unregisterAnalyticsSink("t-good"); unregisterAnalyticsSink("t-bad"); }
  });
  it("the whole signup funnel is recorded, and no event holds a mobile number", async () => {
    const { body } = await requestCode();
    const v = await verify(body.data.challengeId, devOutbox.last(MOBILE)!);
    await call((await route("auth/register")).POST, "POST", "/x", { body: { signupToken: v.body.data.signupToken, name: "Ravi Kumar", language: "en", pincode: "261001", acceptTerms: true } });
    const names = db().analytics.map((e) => e.name);
    for (const n of ["otp_requested", "otp_verified", "location_selected", "signup_completed"]) expect(names).toContain(n);
    expect(JSON.stringify(db().analytics)).not.toContain(MOBILE);
    expect(ANALYTICS_EVENTS).toHaveLength(12);
  });
  it("the browser may only report a few harmless events", async () => {
    const h = (await route("analytics/event")).POST;
    expect((await call(h, "POST", "/x", { body: { name: "signup_started", anonId: "anon-12345678" } })).status).toBe(200);
    expect((await call(h, "POST", "/x", { body: { name: "pharmacy_approved" } })).status).toBe(400); // server-only: cannot be forged
    expect((await call(h, "POST", "/x", { body: { name: "first_order_completed" } })).status).toBe(400);
  });
});
