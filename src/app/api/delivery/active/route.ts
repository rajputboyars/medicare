import { handle, requireUser } from "@/server/http";
import { activeDeliveries } from "@/server/services/delivery";

export const GET = handle(async () => activeDeliveries(await requireUser("delivery:execute")));
