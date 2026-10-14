import { handle, requireUser } from "@/server/http";
import { openRequestsForPharmacy } from "@/server/features/medicine-requests/requests.service";

export const GET = handle(async () => openRequestsForPharmacy(await requireUser("inventory:manage")));
