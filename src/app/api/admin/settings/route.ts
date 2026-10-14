import { platformSettingsSchema } from "@/lib/validation";
import { handle, parseBody, requireUser } from "@/server/http";
import { updatePlatformSettings } from "@/server/features/admin/admin.service";
import { settings } from "@/server/store";

export const GET = handle(async () => {
  await requireUser("admin:read");
  return settings();
});
export const PATCH = handle(async (req: Request) => {
  const u = await requireUser("admin:write");
  return updatePlatformSettings(u, await parseBody(req, platformSettingsSchema));
});
