import type { Delivery, Order, OrderStatus, Role } from "@/lib/types";
import { settings } from "@/server/store";

/**
 * Time limits and the cancellation rules, in one place so an admin or a lawyer can read them.
 * Numbers come from platform settings; the matrix below is data, not scattered if-statements.
 */

/** How long an online order may wait for payment (and its retries) before the reserved stock goes back on the shelf. */
export const paymentWindowMs = () => (settings().paymentWindowMinutes ?? 30) * 60_000;
/** How long a pharmacy has to answer before its reservation is given back: quick for ordinary medicines, longer for a prescription review. */
export const PHARMACY_RESPONSE_WINDOW_MS = 2 * 3600_000;
export const PRESCRIPTION_REVIEW_WINDOW_MS = 24 * 3600_000;
export const partialWindowMs = () => (settings().partialProposalMinutes ?? 30) * 60_000;
export const pharmacyWindowFor = (o: Pick<Order, "items">) => (o.items.some((i) => i.prescriptionRequired) ? PRESCRIPTION_REVIEW_WINDOW_MS : PHARMACY_RESPONSE_WINDOW_MS);

export type CancelDecision = "ALLOW" | "REQUEST" | "DENY";

/**
 * CANCELLATION MATRIX
 *
 *  order status                      customer              pharmacy staff       support (SUPER_ADMIN)
 *  PENDING … CONFIRMED               cancel now            cancel now           cancel now
 *  PREPARING                         asks (needs OK)       cancel now           cancel now
 *  READY_FOR_PICKUP, RIDER_ASSIGNED  asks (needs OK)       cancel now           cancel now
 *  PICKED_UP, OUT_FOR_DELIVERY       not possible          not possible         only after the parcel is back at the pharmacy
 *  DELIVERED, CANCELLED              not possible          not possible         not possible
 *
 * "Asks" = the request is recorded and the pharmacy (or support) approves or declines it.
 * After pickup the parcel is in the rider's hands: the order can only end through the failed-delivery / return flow.
 */
const BEFORE_PREPARING: readonly OrderStatus[] = ["PENDING", "PRESCRIPTION_REVIEW", "PRESCRIPTION_APPROVED", "CONFIRMED"];
const BEFORE_PICKUP: readonly OrderStatus[] = [...BEFORE_PREPARING, "PREPARING", "READY_FOR_PICKUP", "RIDER_ASSIGNED"];

export function cancellationRule(o: Pick<Order, "status">, role: Role | "SYSTEM", delivery?: Pick<Delivery, "status">): { decision: CancelDecision; message?: string } {
  const s = o.status;
  if (s === "DELIVERED" || s === "CANCELLED") return { decision: "DENY", message: "This order is already closed." };
  if (role === "SYSTEM") return { decision: "ALLOW" };
  const afterPickup = !BEFORE_PICKUP.includes(s);
  if (afterPickup) {
    if (role === "SUPER_ADMIN" && delivery?.status === "RETURNED_TO_PHARMACY") return { decision: "ALLOW" };
    return { decision: "DENY", message: role === "CUSTOMER" ? "This order is already on its way. If you are not at home, the delivery partner will bring it back and support will help you." : "The parcel has left the pharmacy. Use the failed-delivery and return steps first." };
  }
  if (role === "SUPER_ADMIN" || role === "PHARMACY_ADMIN" || role === "PHARMACIST") return { decision: "ALLOW" };
  if (role === "CUSTOMER") return BEFORE_PREPARING.includes(s) ? { decision: "ALLOW" } : { decision: "REQUEST", message: "The pharmacy has already started on this order. We have asked them to approve your cancellation." };
  return { decision: "DENY" };
}

/** The cancellation matrix as data, for the order screen and for documentation. */
export const CANCELLATION_MATRIX = (["PENDING", "PRESCRIPTION_REVIEW", "PRESCRIPTION_APPROVED", "CONFIRMED", "PREPARING", "READY_FOR_PICKUP", "RIDER_ASSIGNED", "PICKED_UP", "OUT_FOR_DELIVERY", "DELIVERED", "CANCELLED"] as OrderStatus[]).map((status) => ({
  status,
  customer: cancellationRule({ status }, "CUSTOMER").decision,
  pharmacy: cancellationRule({ status }, "PHARMACY_ADMIN").decision,
  support: cancellationRule({ status }, "SUPER_ADMIN").decision,
}));
