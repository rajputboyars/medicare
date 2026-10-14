import type { OtpPurpose } from "@/lib/types";

/**
 * One-time-code delivery. The rest of the app only knows `OtpProvider`; swap the implementation with OTP_PROVIDER.
 *
 *   mock    development and tests only. Keeps the code in memory and logs it. REFUSED in production.
 *   msg91   SMS through MSG91 (needs MSG91_AUTH_KEY and MSG91_TEMPLATE_ID). Add Twilio, Gupshup, WhatsApp the same way.
 *
 * Production never falls back to mock: if no real provider is configured the request fails with a clear error.
 */
export interface OtpProvider {
  readonly name: string;
  send(msg: { mobile: string; code: string; purpose: OtpPurpose; ttlMinutes: number }): Promise<void>;
}

const g = globalThis as unknown as { __mcOtpOutbox?: { mobile: string; code: string; purpose: OtpPurpose; at: number }[] };
const outbox = (g.__mcOtpOutbox ??= []);

/** Development and tests only: lets a developer or a test read the code that "was sent". */
export const devOutbox = {
  last: (mobile: string, purpose?: OtpPurpose) => [...outbox].reverse().find((m) => m.mobile === mobile && (!purpose || m.purpose === purpose))?.code,
  clear: () => { outbox.length = 0; },
};

class MockProvider implements OtpProvider {
  readonly name = "mock";
  async send(msg: { mobile: string; code: string; purpose: OtpPurpose }) {
    outbox.push({ mobile: msg.mobile, code: msg.code, purpose: msg.purpose, at: Date.now() });
    if (outbox.length > 200) outbox.shift();
    console.info(`[otp:mock] code for ${msg.mobile.slice(0, 2)}******${msg.mobile.slice(-2)} (${msg.purpose}) is ${msg.code}`);
  }
}

class Msg91Provider implements OtpProvider {
  readonly name = "msg91";
  async send(msg: { mobile: string; code: string; ttlMinutes: number }) {
    const key = process.env.MSG91_AUTH_KEY;
    const template = process.env.MSG91_TEMPLATE_ID;
    if (!key || !template) throw new Error("MSG91_AUTH_KEY and MSG91_TEMPLATE_ID are required for OTP_PROVIDER=msg91");
    const res = await fetch("https://control.msg91.com/api/v5/otp", {
      method: "POST",
      headers: { authkey: key, "content-type": "application/json" },
      body: JSON.stringify({ template_id: template, mobile: `91${msg.mobile}`, otp: msg.code, otp_expiry: msg.ttlMinutes }),
    });
    if (!res.ok) throw new Error(`MSG91 rejected the request (${res.status})`);
  }
}

export class OtpProviderUnavailable extends Error {}

export function otpProvider(): OtpProvider {
  const production = process.env.NODE_ENV === "production";
  const wanted = process.env.OTP_PROVIDER ?? (production ? "" : "mock");
  if (wanted === "mock") {
    if (production) throw new OtpProviderUnavailable("The mock OTP provider is not allowed in production");
    return new MockProvider();
  }
  if (wanted === "msg91") return new Msg91Provider();
  throw new OtpProviderUnavailable("No OTP provider is configured. Set OTP_PROVIDER.");
}

/**
 * May API responses include the code (so a developer without an SMS gateway can sign in)?
 * Only when the mock provider is active AND we are not in production. Everything else: never.
 */
export function devOtpExposed(): boolean {
  if (process.env.NODE_ENV === "production") return false;
  return (process.env.OTP_PROVIDER ?? "mock") === "mock";
}
