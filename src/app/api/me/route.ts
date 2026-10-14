import { z } from "zod";
import { LANGUAGE_CODES } from "@/i18n/languages";
import { handle, parseBody, requireUser } from "@/server/http";
import { updateConsent } from "@/server/features/accounts/accounts.service";

const schema = z.object({ healthData: z.boolean().optional(), marketing: z.boolean().optional(), language: z.enum(LANGUAGE_CODES).optional() });

export const PATCH = handle(async (req: Request) => {
  const u = await requireUser();
  return updateConsent(u.id, await parseBody(req, schema));
});
