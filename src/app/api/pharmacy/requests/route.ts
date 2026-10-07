import { handle, requireUser } from "@/server/http";
import { openRequestsForPharmacy } from "@/server/services/requests";

export const GET = handle(async () => openRequestsForPharmacy(await requireUser("inventory:manage")));
