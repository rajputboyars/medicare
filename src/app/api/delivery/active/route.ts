import { handle, requireUser } from "@/server/http";
import { activeDeliveries } from "@/server/features/delivery/delivery.service";

export const GET = handle(async () => activeDeliveries(await requireUser("delivery:execute")));
