import { handle, requireUser } from "@/server/http";
import { pharmacyStats } from "@/server/features/pharmacy/pharmacy.service";

export const GET = handle(async () => pharmacyStats(await requireUser("inventory:manage")));
