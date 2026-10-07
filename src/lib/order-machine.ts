import type { OrderStatus, Role } from "./types";

/**
 * Order state machine. Single source of truth for which status can follow which, and who may move it.
 *
 *   Non-Rx : PENDING ─────────────────────────────▶ CONFIRMED
 *   Rx     : PRESCRIPTION_REVIEW ▶ PRESCRIPTION_APPROVED ▶ CONFIRMED
 *   then   : ▶ PREPARING ▶ READY_FOR_PICKUP ▶ RIDER_ASSIGNED ▶ PICKED_UP ▶ OUT_FOR_DELIVERY ▶ DELIVERED
 *   any non-final state may go to CANCELLED, subject to the cut-offs below.
 */
export type Actor = Role | "SYSTEM";

interface Edge {
  to: OrderStatus;
  by: readonly Actor[];
}

const STAFF = ["PHARMACY_ADMIN", "PHARMACIST"] as const;

export const TRANSITIONS: Record<OrderStatus, readonly Edge[]> = {
  PENDING: [
    { to: "CONFIRMED", by: STAFF },
    { to: "CANCELLED", by: ["CUSTOMER", ...STAFF, "SUPER_ADMIN"] },
  ],
  PRESCRIPTION_REVIEW: [
    { to: "PRESCRIPTION_APPROVED", by: ["PHARMACIST", "PHARMACY_ADMIN"] },
    { to: "CANCELLED", by: ["CUSTOMER", ...STAFF, "SUPER_ADMIN"] },
  ],
  PRESCRIPTION_APPROVED: [
    { to: "CONFIRMED", by: STAFF },
    { to: "CANCELLED", by: ["CUSTOMER", ...STAFF, "SUPER_ADMIN"] },
  ],
  CONFIRMED: [
    { to: "PREPARING", by: STAFF },
    { to: "CANCELLED", by: ["CUSTOMER", ...STAFF, "SUPER_ADMIN"] },
  ],
  PREPARING: [
    { to: "READY_FOR_PICKUP", by: STAFF },
    { to: "CANCELLED", by: ["CUSTOMER", ...STAFF, "SUPER_ADMIN"] },
  ],
  READY_FOR_PICKUP: [
    { to: "RIDER_ASSIGNED", by: [...STAFF, "DELIVERY_PARTNER", "SUPER_ADMIN"] },
    { to: "CANCELLED", by: ["CUSTOMER", ...STAFF, "SUPER_ADMIN"] },
  ],
  // Once a rider is assigned the customer can still cancel until pickup; the rider is released.
  RIDER_ASSIGNED: [
    { to: "PICKED_UP", by: ["DELIVERY_PARTNER"] },
    { to: "READY_FOR_PICKUP", by: [...STAFF, "DELIVERY_PARTNER", "SUPER_ADMIN"] }, // rider drops the job / reassign
    { to: "CANCELLED", by: ["CUSTOMER", ...STAFF, "SUPER_ADMIN"] },
  ],
  PICKED_UP: [
    { to: "OUT_FOR_DELIVERY", by: ["DELIVERY_PARTNER"] },
    { to: "CANCELLED", by: ["SUPER_ADMIN"] },
  ],
  OUT_FOR_DELIVERY: [
    { to: "DELIVERED", by: ["DELIVERY_PARTNER"] },
    { to: "CANCELLED", by: ["SUPER_ADMIN"] },
  ],
  DELIVERED: [],
  CANCELLED: [],
};

export const FINAL_STATUSES: readonly OrderStatus[] = ["DELIVERED", "CANCELLED"];
export const isFinal = (s: OrderStatus) => FINAL_STATUSES.includes(s);

/** Statuses from which stock has been reserved (from CONFIRMED onward). */
export const STOCK_RESERVED_FROM: readonly OrderStatus[] = ["CONFIRMED", "PREPARING", "READY_FOR_PICKUP", "RIDER_ASSIGNED", "PICKED_UP", "OUT_FOR_DELIVERY"];

export function canTransition(from: OrderStatus, to: OrderStatus, actor: Actor): boolean {
  return TRANSITIONS[from].some((e) => e.to === to && e.by.includes(actor));
}

export function allowedNext(from: OrderStatus, actor: Actor): OrderStatus[] {
  return TRANSITIONS[from].filter((e) => e.by.includes(actor)).map((e) => e.to);
}

/** The happy-path steps shown to customers. Rx orders show the two review steps; others skip them. */
export function happyPath(rx: boolean): OrderStatus[] {
  const core: OrderStatus[] = ["CONFIRMED", "PREPARING", "READY_FOR_PICKUP", "RIDER_ASSIGNED", "PICKED_UP", "OUT_FOR_DELIVERY", "DELIVERED"];
  return rx ? ["PRESCRIPTION_REVIEW", "PRESCRIPTION_APPROVED", ...core] : ["PENDING", ...core];
}

export const STATUS_LABEL: Record<OrderStatus, string> = {
  PENDING: "Order placed",
  PRESCRIPTION_REVIEW: "Prescription under review",
  PRESCRIPTION_APPROVED: "Prescription approved",
  CONFIRMED: "Order confirmed",
  PREPARING: "Pharmacy preparing",
  READY_FOR_PICKUP: "Ready for pickup",
  RIDER_ASSIGNED: "Rider assigned",
  PICKED_UP: "Picked up",
  OUT_FOR_DELIVERY: "Out for delivery",
  DELIVERED: "Delivered",
  CANCELLED: "Cancelled",
};

export const statusTone = (s: OrderStatus): "green" | "amber" | "red" | "blue" =>
  s === "DELIVERED" ? "green" : s === "CANCELLED" ? "red" : s === "PRESCRIPTION_REVIEW" || s === "PENDING" ? "amber" : "blue";

export function timeline(o: { items: { prescriptionRequired: boolean }[]; statusHistory: { status: OrderStatus; at: string }[]; status: OrderStatus }) {
  const rx = o.items.some((i) => i.prescriptionRequired) || o.statusHistory.some((h) => h.status === "PRESCRIPTION_REVIEW");
  const steps = happyPath(rx);
  const reached = new Set(o.statusHistory.map((h) => h.status));
  const idx = steps.indexOf(o.status);
  return steps.map((s, i) => ({
    status: s,
    label: STATUS_LABEL[s],
    done: reached.has(s) || (idx >= 0 && i < idx),
    current: s === o.status,
    at: o.statusHistory.find((h) => h.status === s)?.at,
  }));
}
