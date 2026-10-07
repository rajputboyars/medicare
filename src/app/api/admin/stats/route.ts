import { handle, requireUser } from "@/server/http";
import { adminStats } from "@/server/services/admin";

export const GET = handle(async () => {
  await requireUser("admin:read");
  return adminStats();
});
