import { handle, requireUser } from "@/server/http";
import { availableDeliveries } from "@/server/features/delivery/delivery.service";

/** Ready orders nobody has taken. No customer identity, no medicines. */
export const GET = handle(async () => availableDeliveries(await requireUser("delivery:execute")));
