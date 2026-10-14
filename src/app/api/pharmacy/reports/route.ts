import { handle, requireUser } from "@/server/http";
import { reportsOf } from "@/server/features/pharmacy/pharmacy.service";

export const GET = handle(async () => reportsOf(await requireUser("inventory:manage")));
