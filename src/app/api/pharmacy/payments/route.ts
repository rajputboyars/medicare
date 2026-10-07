import { handle, requireUser } from "@/server/http";
import { paymentsOf } from "@/server/services/pharmacy";

export const GET = handle(async () => paymentsOf(await requireUser("inventory:manage")));
