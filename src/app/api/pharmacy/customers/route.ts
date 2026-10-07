import { handle, requireUser } from "@/server/http";
import { customersOf } from "@/server/services/pharmacy";

export const GET = handle(async () => customersOf(await requireUser("inventory:manage")));
