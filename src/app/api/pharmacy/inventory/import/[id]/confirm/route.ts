import { z } from "zod";
import { WithMessage } from "@/server/core/response";
import { handle, parseBody, requireUser } from "@/server/http";
import { confirmImport } from "@/server/features/inventory/import.service";

/**
 * Step 2: apply the preview. `choices` maps a line number to the medicine picked for a POSSIBLE_MATCH (or "SKIP").
 * Unresolved or NOT_FOUND rows are sent to admin review; no catalogue record is ever created from here.
 */
export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const u = await requireUser("inventory:manage");
  const { choices } = await parseBody(req, z.object({ choices: z.record(z.string().regex(/^\d+$/), z.string().min(1).max(60)).default({}) }).strict());
  return new WithMessage(confirmImport(u, (await ctx.params).id, choices), "Import finished");
});
