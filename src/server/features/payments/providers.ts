import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { PaymentMethod } from "@/lib/types";
import { ApiError } from "../../errors";

/**
 * Provider-independent payments.
 *
 * Orders and payments only ever talk to `PaymentProvider`. A gateway (Razorpay, Cashfree, PayU...) is one implementation of it.
 * What a gateway calls things (`providerOrderId`, `providerPaymentId`) is stored on the Payment and PaymentAttempt rows, never
 * on the Order. Amounts cross this boundary in PAISE (integers), like every real gateway.
 *
 *   createPayment   open a payment with the gateway for one attempt; returns what the app needs to open its checkout
 *   verifyPayment   is this webhook really from the gateway? (signature over the raw body)
 *   parseWebhook    turn the gateway's payload into our normalised event
 *   getPaymentStatus ask the gateway (reconciliation, if a webhook was missed)
 *   refundPayment   send money back
 *
 * To go live: implement this interface for the gateway, register it (`registerPaymentProvider`) and set PAYMENT_PROVIDER.
 * Production refuses the mock provider.
 */
export type WebhookType = "PAYMENT_CAPTURED" | "PAYMENT_FAILED" | "REFUND_PROCESSED" | "REFUND_FAILED";

export interface NormalizedWebhook {
  /** The gateway's unique id for this notification: the basis of webhook idempotency */
  eventId: string;
  type: WebhookType;
  providerOrderId?: string;
  providerPaymentId?: string;
  providerRefundId?: string;
  amountPaise?: number;
  failureCode?: string;
  failureMessage?: string;
}

export interface PaymentProvider {
  readonly name: string;
  /** false for cash: there is no gateway to call */
  readonly online: boolean;
  createPayment(i: { paymentId: string; orderId: string; amountPaise: number; currency: "INR"; attemptNumber: number; method: PaymentMethod }): { providerOrderId: string; checkout?: Record<string, string> };
  verifyPayment(rawBody: string, signature: string | null): boolean;
  parseWebhook(rawBody: string): NormalizedWebhook;
  getPaymentStatus(providerOrderId: string): { status: "CREATED" | "PAID" | "FAILED"; providerPaymentId?: string };
  refundPayment(i: { providerPaymentId: string; amountPaise: number; idempotencyKey: string; reason: string }): { providerRefundId: string; status: "COMPLETED" | "PROCESSING" | "FAILED"; failureMessage?: string };
}

const registry = new Map<string, PaymentProvider>();
export function registerPaymentProvider(p: PaymentProvider) { registry.set(p.name, p); }
export const unregisterPaymentProvider = (name: string) => registry.delete(name);

export const toPaise = (rupees: number) => Math.round(rupees * 100);

// ───────────── Cash on delivery ─────────────

const cod: PaymentProvider = {
  name: "COD",
  online: false,
  createPayment() { throw new ApiError(400, "Cash on delivery has no online payment"); },
  verifyPayment: () => false,
  parseWebhook() { throw new ApiError(400, "Cash on delivery has no webhooks"); },
  getPaymentStatus: () => ({ status: "CREATED" }),
  refundPayment() { throw new ApiError(400, "Cash on delivery has nothing to refund online"); },
};

// ───────────── Mock gateway (development and tests only) ─────────────

const webhookSecret = () => process.env.MOCK_WEBHOOK_SECRET ?? "mock-gateway-dev-secret";
export const signMockWebhook = (rawBody: string) => createHmac("sha256", webhookSecret()).update(rawBody).digest("hex");

/** What the mock gateway does when asked to refund. Tests change this to exercise slow and failing gateways. */
export const mockGateway = { refund: "COMPLETED" as "COMPLETED" | "PROCESSING" | "FAILED", reset() { this.refund = "COMPLETED"; } };
const mockOrders = new Map<string, { status: "CREATED" | "PAID" | "FAILED"; providerPaymentId?: string }>();
const refundsDone = new Map<string, string>(); // idempotencyKey → providerRefundId (a real gateway does this too)

const mock: PaymentProvider = {
  name: "MOCK",
  online: true,
  createPayment(i) {
    const providerOrderId = `mock_order_${i.paymentId.slice(-6)}_${i.attemptNumber}_${randomBytes(3).toString("hex")}`;
    mockOrders.set(providerOrderId, { status: "CREATED" });
    return { providerOrderId, checkout: { gateway: "mock", providerOrderId, amountPaise: String(i.amountPaise), currency: i.currency } };
  },
  verifyPayment(rawBody, signature) {
    if (!signature) return false;
    const a = Buffer.from(signMockWebhook(rawBody), "hex"), b = Buffer.from(signature, "hex");
    return a.length === b.length && timingSafeEqual(a, b);
  },
  parseWebhook(rawBody) {
    const j = JSON.parse(rawBody) as Record<string, unknown>;
    const str = (k: string) => (typeof j[k] === "string" ? (j[k] as string) : undefined);
    const type = str("type") as WebhookType;
    if (!str("eventId") || !["PAYMENT_CAPTURED", "PAYMENT_FAILED", "REFUND_PROCESSED", "REFUND_FAILED"].includes(type)) throw new ApiError(400, "Unrecognised webhook");
    const ev: NormalizedWebhook = {
      eventId: str("eventId")!, type, providerOrderId: str("providerOrderId"), providerPaymentId: str("providerPaymentId"), providerRefundId: str("providerRefundId"),
      amountPaise: typeof j.amountPaise === "number" ? j.amountPaise : undefined, failureCode: str("failureCode"), failureMessage: str("failureMessage"),
    };
    const o = ev.providerOrderId ? mockOrders.get(ev.providerOrderId) : undefined;
    if (o && type === "PAYMENT_CAPTURED") { o.status = "PAID"; o.providerPaymentId = ev.providerPaymentId; }
    if (o && type === "PAYMENT_FAILED") o.status = "FAILED";
    return ev;
  },
  getPaymentStatus: (id) => mockOrders.get(id) ?? { status: "CREATED" },
  refundPayment(i) {
    const existing = refundsDone.get(i.idempotencyKey);
    if (existing) return { providerRefundId: existing, status: mockGateway.refund };
    const providerRefundId = `mock_rf_${randomBytes(4).toString("hex")}`;
    if (mockGateway.refund !== "FAILED") refundsDone.set(i.idempotencyKey, providerRefundId);
    return { providerRefundId, status: mockGateway.refund, failureMessage: mockGateway.refund === "FAILED" ? "The gateway could not process the refund" : undefined };
  },
};

registerPaymentProvider(cod);
registerPaymentProvider(mock);

export function providerNamed(name: string): PaymentProvider {
  const p = registry.get(name);
  if (!p) throw new ApiError(400, "Unknown payment provider");
  return p;
}

/** The provider that handles a payment method. Cash → COD. Everything else → PAYMENT_PROVIDER (default MOCK outside production). */
export function providerForMethod(method: PaymentMethod): PaymentProvider {
  if (method === "COD") return cod;
  const production = process.env.NODE_ENV === "production";
  const wanted = (process.env.PAYMENT_PROVIDER ?? (production ? "" : "mock")).toUpperCase();
  if (wanted === "MOCK" && production) throw new ApiError(503, "Online payment is not available right now.", undefined, "PAYMENT_UNAVAILABLE");
  const p = registry.get(wanted);
  if (!p) throw new ApiError(503, "Online payment is not available right now.", undefined, "PAYMENT_UNAVAILABLE");
  return p;
}

/** The mock gateway may only be driven by hand (the dev "pay now" button) when it is the active provider and we are not in production. */
export const mockGatewayEnabled = () => process.env.NODE_ENV !== "production" && (process.env.PAYMENT_PROVIDER ?? "mock").toUpperCase() === "MOCK";
