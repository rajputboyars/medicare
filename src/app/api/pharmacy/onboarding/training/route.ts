import { handle, requireUser } from "@/server/http";
import { completeTraining } from "@/server/features/pharmacy/setup.service";

export const POST = handle(async () => completeTraining(await requireUser("inventory:manage")));
