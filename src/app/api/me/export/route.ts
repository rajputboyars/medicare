import { handle, requireUser } from "@/server/http";
import { exportUserData } from "@/server/services/accounts";
import { audit } from "@/server/store";

export const GET = handle(async () => {
  const u = await requireUser();
  audit(u, "DATA_EXPORT", "User", u.id);
  return exportUserData(u.id);
});
