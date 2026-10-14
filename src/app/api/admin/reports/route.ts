import { handle, requireUser } from "@/server/http";
import { platformReports } from "@/server/features/admin/admin.service";

export const GET = handle(async () => {
  await requireUser("admin:read");
  return platformReports();
});
