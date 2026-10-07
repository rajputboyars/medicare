import { handle, requireUser } from "@/server/http";
import { availableDeliveries } from "@/server/services/delivery";

export const GET = handle(async () => availableDeliveries(await requireUser("delivery:execute")));
