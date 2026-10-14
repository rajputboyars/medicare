import { handle, requireUser } from "@/server/http";
import { paymentsOf } from "@/server/features/pharmacy/pharmacy.service";

export const GET = handle(async () => paymentsOf(await requireUser("inventory:manage")));
