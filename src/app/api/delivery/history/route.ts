import { handle, requireUser } from "@/server/http";
import { deliveryHistory } from "@/server/features/delivery/delivery.service";

export const GET = handle(async () => deliveryHistory(await requireUser("delivery:execute")));
