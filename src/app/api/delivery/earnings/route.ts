import { handle, requireUser } from "@/server/http";
import { earningsSummary } from "@/server/features/delivery/delivery.service";

export const GET = handle(async () => earningsSummary(await requireUser("delivery:execute")));
