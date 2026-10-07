import { z } from "zod";
import { handle, parseBody, requireUser } from "@/server/http";
import { advanceAsPharmacy, assignRider, rejectOrder, reviewOrderPrescription } from "@/server/services/orders";

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("review"), decision: z.enum(["APPROVE", "REJECT", "CLARIFY"]), note: z.string().trim().max(240).optional() }),
  z.object({ action: z.literal("step"), step: z.enum(["confirm", "prepare", "ready"]) }),
  z.object({ action: z.literal("reject"), note: z.string().trim().min(3).max(240) }),
  z.object({ action: z.literal("assign"), partnerId: z.string().optional() }),
]);

export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const u = await requireUser("order:fulfil");
  const { id } = await ctx.params;
  const b = await parseBody(req, schema);
  const o =
    b.action === "review" ? reviewOrderPrescription(u, id, b.decision, b.note)
    : b.action === "step" ? advanceAsPharmacy(u, id, b.step)
    : b.action === "reject" ? rejectOrder(u, id, b.note)
    : assignRider(u, id, b.partnerId);
  return { id: o.id, status: o.status };
});
