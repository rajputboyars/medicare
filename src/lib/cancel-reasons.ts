import type { CancelReasonCode } from "./types";

/** Plain-language reasons shown on the cancel screen. The first few are what a customer can pick; the rest are set by the system or staff. */
export const CANCEL_REASON_LABEL: Record<CancelReasonCode, string> = {
  CHANGED_MIND: "I changed my mind",
  ORDERED_BY_MISTAKE: "I ordered by mistake",
  TOO_SLOW: "It is taking too long",
  FOUND_ELSEWHERE: "I found the medicine elsewhere",
  PAYMENT_ISSUE: "Payment problem",
  MEDICINE_UNAVAILABLE: "Medicine not available",
  PRESCRIPTION_REJECTED: "Prescription could not be verified",
  CUSTOMER_DECLINED_PARTIAL: "Some medicines were unavailable",
  NO_RESPONSE: "No response in time",
  DELIVERY_FAILED: "Delivery could not be completed",
  ADDRESS_PROBLEM: "Problem with the address",
  OTHER: "Other reason",
};

/** What a customer may choose themselves. */
export const CUSTOMER_CANCEL_REASONS: CancelReasonCode[] = ["CHANGED_MIND", "ORDERED_BY_MISTAKE", "TOO_SLOW", "FOUND_ELSEWHERE", "PAYMENT_ISSUE", "OTHER"];
