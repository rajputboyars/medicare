import { serviceAreaSchema } from "@/lib/validation";
import { handle, parseBody, requireUser } from "@/server/http";
import { addServiceArea, listServiceAreas } from "@/server/services/admin";

export const GET = handle(async () => {
  await requireUser("admin:read");
  return listServiceAreas();
});
export const POST = handle(async (req: Request) => {
  const u = await requireUser("admin:write");
  return addServiceArea(u, await parseBody(req, serviceAreaSchema));
});
