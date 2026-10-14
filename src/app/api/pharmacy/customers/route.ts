import { handle, requireUser } from "@/server/http";
import { customersOf } from "@/server/features/pharmacy/pharmacy.service";

export const GET = handle(async () => customersOf(await requireUser("inventory:manage")));
