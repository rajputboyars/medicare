import { handle, requireUser } from "@/server/http";
import { prescriptionQueue } from "@/server/features/pharmacy/pharmacy.service";

export const GET = handle(async () => prescriptionQueue(await requireUser("prescription:review")));
