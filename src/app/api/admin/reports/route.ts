import { handle, requireUser } from "@/server/http";
import { platformReports } from "@/server/services/admin";

export const GET = handle(async () => {
  await requireUser("admin:read");
  return platformReports();
});
