import { handle, requireUser } from "@/server/http";
import { reportsOf } from "@/server/services/pharmacy";

export const GET = handle(async () => reportsOf(await requireUser("inventory:manage")));
