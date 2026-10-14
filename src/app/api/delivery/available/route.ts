import { handle, requireUser } from "@/server/http";
import { availableDeliveries } from "@/server/features/delivery/delivery.service";

export const GET = handle(async () => availableDeliveries(await requireUser("delivery:execute")));
