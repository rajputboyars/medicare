import { handle, requireUser } from "@/server/http";
import { deliveryHistory } from "@/server/services/delivery";

export const GET = handle(async () => deliveryHistory(await requireUser("delivery:execute")));
