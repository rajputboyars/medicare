import { z } from "zod";
import { handle, parseBody, requireUser } from "@/server/http";
import { respondToRequest } from "@/server/services/requests";

const schema = z.object({
  response: z.enum(["AVAILABLE", "ALTERNATIVE", "OUT_OF_STOCK"]),
  alternative: z.string().trim().max(100).optional(),
  restockEta: z.string().trim().max(60).optional(),
});

export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const u = await requireUser("inventory:manage");
  const { response, ...extra } = await parseBody(req, schema);
  const r = respondToRequest(u, (await ctx.params).id, response, extra);
  return { id: r.id, status: r.status };
});
