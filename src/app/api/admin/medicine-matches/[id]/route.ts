import { z } from "zod";
import { WithMessage } from "@/server/core/response";
import { handle, parseBody, requireElevated } from "@/server/http";
import { resolveMatchReview } from "@/server/features/inventory/import.service";
import { medicineInputSchema } from "../../medicines/route";

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("MATCH"), medicineId: z.string().min(1) }),
  z.object({ action: z.literal("CREATE"), medicine: medicineInputSchema, confirmNotDuplicate: z.boolean().optional() }),
  z.object({ action: z.literal("REJECT"), note: z.string().trim().min(3).max(300) }),
]);

/** Resolve one unmatched inventory line: attach it to an existing medicine, create a new one (duplicates are refused), or reject it. */
export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const u = await requireElevated();
  return new WithMessage(resolveMatchReview(u, (await ctx.params).id, await parseBody(req, schema)), "Done");
});
