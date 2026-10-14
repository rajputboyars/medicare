import { handle, requireUser } from "@/server/http";
import { exportUserData } from "@/server/features/accounts/accounts.service";
import { audit } from "@/server/store";

export const GET = handle(async () => {
  const u = await requireUser();
  audit(u, "DATA_EXPORT", "User", u.id);
  return exportUserData(u.id);
});
