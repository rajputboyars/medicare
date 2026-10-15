import { preferencesSchema } from "@/lib/validation";
import { handle, parseBody, requireUser } from "@/server/http";
import { updateConsent, updatePreferences } from "@/server/features/accounts/accounts.service";

/** Comfort settings that follow the person to every device: large text, large controls, simple screen, language. */
export const PATCH = handle(async (req: Request) => {
  const u = await requireUser();
  const { language, ...prefs } = await parseBody(req, preferencesSchema);
  if (language) updateConsent(u.id, { language });
  return updatePreferences(u.id, prefs);
});
