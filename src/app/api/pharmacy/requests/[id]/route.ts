import { requestReplySchema } from "@/lib/validation";
import { handle, parseBody, requireUser } from "@/server/http";
import { respondToRequest } from "@/server/services/requests";

export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const u = await requireUser("inventory:manage");
  const { response, ...extra } = await parseBody(req, requestReplySchema);
  const r = respondToRequest(u, (await ctx.params).id, response, extra);
  return { id: r.id, status: r.status };
});
