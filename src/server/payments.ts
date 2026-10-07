import type { Order, Payment, PaymentMethod } from "@/lib/types";

/**
 * Payment-ready architecture. Orders talk to a `PaymentProvider`, never to a gateway SDK directly.
 * V1 ships COD (collected by the rider) and a MOCK gateway for UPI/card. To go live, implement
 * `RazorpayProvider` (create order → verify signature in a webhook → refund) and register it in `providerFor`.
 */
export interface PaymentProvider {
  readonly name: Payment["provider"];
  /** Called when an order is placed. Returns the initial payment state. */
  initiate(order: Pick<Order, "id" | "total">): { status: Payment["status"]; providerRef?: string };
  /** Called when the customer completes the online payment (webhook / client callback). */
  capture(order: Pick<Order, "id" | "total">, providerRef: string): { status: Payment["status"] };
  refund(order: Pick<Order, "id" | "total">): { status: Payment["status"] };
}

const cod: PaymentProvider = {
  name: "COD",
  initiate: () => ({ status: "COD_DUE" }),
  capture: () => ({ status: "PAID" }), // marked paid when the rider hands over the parcel and collects cash
  refund: () => ({ status: "REFUNDED" }),
};

const mock: PaymentProvider = {
  name: "MOCK",
  initiate: (o) => ({ status: "PENDING", providerRef: `mock_${o.id}` }),
  capture: () => ({ status: "PAID" }),
  refund: () => ({ status: "REFUNDED" }),
};

export function providerFor(method: PaymentMethod): PaymentProvider {
  if (method === "COD") return cod;
  // if (process.env.PAYMENT_PROVIDER === "razorpay") return razorpay;
  return mock;
}
