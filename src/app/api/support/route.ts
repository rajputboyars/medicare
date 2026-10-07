import { supportTicketSchema } from "@/lib/validation";
import { handle, limit, parseBody, requireUser } from "@/server/http";
import { createTicket } from "@/server/services/admin";
import { db } from "@/server/store";

export const GET = handle(async () => {
  const u = await requireUser();
  return db().tickets.filter((t) => t.userId === u.id);
});
export const POST = handle(async (req: Request) => {
  const u = await requireUser();
  await limit("ticket", 10, 60 * 60_000, u.id);
  return createTicket(u.id, await parseBody(req, supportTicketSchema));
});
