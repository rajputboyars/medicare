import { savedMedicinesSchema } from "@/lib/validation";
import { handle, parseBody, requireUser } from "@/server/http";
import { listSaved, saveMedicines } from "@/server/services/requests";

export const GET = handle(async () => listSaved((await requireUser("order:create")).id));
export const POST = handle(async (req: Request) => {
  const u = await requireUser("order:create");
  return saveMedicines(u.id, await parseBody(req, savedMedicinesSchema));
});
