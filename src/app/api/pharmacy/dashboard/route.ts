import { handle, requireUser } from "@/server/http";
import { pharmacyStats } from "@/server/services/pharmacy";

export const GET = handle(async () => pharmacyStats(await requireUser("inventory:manage")));
