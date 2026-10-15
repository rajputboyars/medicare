import { handle, requireUser } from "@/server/http";
import { markWalkthroughSeen } from "@/server/features/pharmacy/setup.service";

/** The first-time dashboard tour was shown (or skipped): do not show it again. */
export const POST = handle(async () => markWalkthroughSeen(await requireUser("inventory:manage")));
