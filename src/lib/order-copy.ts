import type { OrderStatus } from "./types";

export interface CopyContext {
  /** Pharmacy name, e.g. "Shree Ram Medical Store" */
  pharmacy?: string;
  /** Rider's first name */
  rider?: string;
  note?: string;
}

/** Plain-language sentence for every order status: what is happening now, in words a first-time user understands. */
export function describeStatus(status: OrderStatus, c: CopyContext = {}): string {
  const ph = c.pharmacy ?? "The pharmacy";
  const rider = c.rider ?? "Your delivery partner";
  switch (status) {
    case "PENDING": return `${ph} has your order and will confirm it shortly.`;
    case "PRESCRIPTION_REVIEW": return `A pharmacist at ${ph} is checking your prescription.`;
    case "PRESCRIPTION_APPROVED": return "Your prescription is approved. The pharmacy will confirm your order next.";
    case "CONFIRMED": return `${ph} confirmed your order.`;
    case "PREPARING": return `${ph} is preparing your medicines.`;
    case "READY_FOR_PICKUP": return "Your medicines are packed. We are finding a delivery partner.";
    case "RIDER_ASSIGNED": return `${rider} will collect your order from ${ph}.`;
    case "PICKED_UP": return `${rider} has your medicines and is getting ready to leave.`;
    case "OUT_FOR_DELIVERY": return `${rider} is on the way. Keep your delivery code ready.`;
    case "DELIVERED": return "Delivered. We hope you feel better soon.";
    case "CANCELLED": return c.note ? `This order was cancelled. ${c.note}` : "This order was cancelled.";
  }
}

/** Shorter label for a one-line summary (order lists). */
export function shortStatus(status: OrderStatus): string {
  switch (status) {
    case "PENDING": return "Waiting for pharmacy";
    case "PRESCRIPTION_REVIEW": return "Prescription being checked";
    case "PRESCRIPTION_APPROVED": return "Prescription approved";
    case "CONFIRMED": return "Order confirmed";
    case "PREPARING": return "Being prepared";
    case "READY_FOR_PICKUP": return "Ready, finding delivery partner";
    case "RIDER_ASSIGNED": return "Delivery partner assigned";
    case "PICKED_UP": return "Picked up";
    case "OUT_FOR_DELIVERY": return "On the way";
    case "DELIVERED": return "Delivered";
    case "CANCELLED": return "Cancelled";
  }
}

/** Past-tense sentence for steps that are already finished. */
export function describeDone(status: OrderStatus, c: CopyContext = {}): string {
  const ph = c.pharmacy ?? "The pharmacy";
  const rider = c.rider ?? "Your delivery partner";
  switch (status) {
    case "PENDING": return `${ph} received your order.`;
    case "PRESCRIPTION_REVIEW": return "A pharmacist checked your prescription.";
    case "PRESCRIPTION_APPROVED": return "Your prescription was approved.";
    case "CONFIRMED": return `${ph} confirmed your order.`;
    case "PREPARING": return `${ph} prepared your medicines.`;
    case "READY_FOR_PICKUP": return "Your medicines were packed and ready.";
    case "RIDER_ASSIGNED": return `${rider} accepted your delivery.`;
    case "PICKED_UP": return `${rider} collected your medicines.`;
    case "OUT_FOR_DELIVERY": return `${rider} set off to deliver.`;
    case "DELIVERED": return "Delivered. We hope you feel better soon.";
    case "CANCELLED": return "This order was cancelled.";
  }
}
