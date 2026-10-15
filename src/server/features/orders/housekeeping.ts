import { purgeIdempotency } from "@/server/idempotency";
import { promoteEligibleSettlements } from "@/server/features/settlements/settlements.service";
import { expireReservations } from "./orders.service";
import { expirePartialProposals } from "./partial-fulfillment";

/** Everything that must happen because time passed, in one place. Called by the server's timer and by tests. */
export function runOrderHousekeeping(at = Date.now()): number {
  return expireReservations(at) + expirePartialProposals(at) + promoteEligibleSettlements(at) + purgeIdempotency(at);
}
