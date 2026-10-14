import { z } from "zod";
import { handle, parseBody, requireUser } from "@/server/http";
import { updateConsent } from "@/server/features/accounts/accounts.service";

const schema = z.object({ healthData: z.boolean().optional(), marketing: z.boolean().optional(), language: z.enum(["en", "hi"]).optional() });

export const PATCH = handle(async (req: Request) => {
  const u = await requireUser();
  return updateConsent(u.id, await parseBody(req, schema));
});
