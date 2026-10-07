import { handle, requireUser } from "@/server/http";
import { prescriptionQueue } from "@/server/services/pharmacy";

export const GET = handle(async () => prescriptionQueue(await requireUser("prescription:review")));
