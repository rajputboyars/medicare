import type { SessionUser } from "@/lib/types";
import { mockComplete, paymentOf } from "@/server/features/payments/payment.service";
import { db } from "@/server/store";

/** Stands in for the gateway: sends the SIGNED success webhook for the order's open payment (the only way an online payment becomes PAID). */
export function confirmPayment(user: SessionUser, orderId: string) {
  const o = db().orders.find((x) => x.id === orderId || x.code === orderId)!;
  const pay = paymentOf(o.id)!;
  if (pay.method === "COD") throw new Error("This order is Cash on Delivery");
  mockComplete(user, pay.id, "success");
  return o;
}

export function failPayment(user: SessionUser, orderId: string) {
  const o = db().orders.find((x) => x.id === orderId || x.code === orderId)!;
  mockComplete(user, paymentOf(o.id)!.id, "failure");
  return o;
}
