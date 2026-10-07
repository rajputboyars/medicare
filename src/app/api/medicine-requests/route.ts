import { medicineRequestSchema } from "@/lib/validation";
import { currentUser, handle, limit, parseBody, requireUser } from "@/server/http";
import { createMedicineRequest, myRequests } from "@/server/services/requests";

export const GET = handle(async () => myRequests(await requireUser()));

export const POST = handle(async (req: Request) => {
  await limit("medreq", 6, 60 * 60_000);
  const b = await parseBody(req, medicineRequestSchema);
  const u = await currentUser();
  return createMedicineRequest(b, u?.id);
});
