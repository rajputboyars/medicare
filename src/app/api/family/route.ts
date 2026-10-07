import { familyMemberSchema } from "@/lib/validation";
import { handle, parseBody, requireUser } from "@/server/http";
import { listFamily, saveFamily } from "@/server/services/accounts";

export const GET = handle(async () => listFamily((await requireUser()).id));
export const POST = handle(async (req: Request) => {
  const u = await requireUser();
  return saveFamily(u.id, await parseBody(req, familyMemberSchema));
});
