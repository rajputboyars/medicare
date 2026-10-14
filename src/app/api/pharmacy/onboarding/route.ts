import { handle, requireUser } from "@/server/http";
import { setupChecklist } from "@/server/features/pharmacy/setup.service";

/** The post-approval setup checklist and completion percentage. */
export const GET = handle(async () => setupChecklist(await requireUser("inventory:manage")));
