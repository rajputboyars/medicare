import { addressSchema } from "@/lib/validation";
import { handle, parseBody, requireUser } from "@/server/http";
import { listAddresses, saveAddress } from "@/server/services/accounts";

export const GET = handle(async () => listAddresses((await requireUser()).id));
export const POST = handle(async (req: Request) => {
  const u = await requireUser();
  return saveAddress(u.id, await parseBody(req, addressSchema));
});
