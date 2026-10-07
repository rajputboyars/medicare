import { handle, requireUser } from "@/server/http";
import { earningsSummary } from "@/server/services/delivery";

export const GET = handle(async () => earningsSummary(await requireUser("delivery:execute")));
