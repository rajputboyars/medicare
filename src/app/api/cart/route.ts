import { cartSchema } from "@/lib/validation";
import { handle, parseBody, requireUser } from "@/server/http";
import { getCart, saveCart } from "@/server/features/medicine-requests/requests.service";

export const GET = handle(async () => getCart(await requireUser("order:create")));
export const PUT = handle(async (req: Request) => {
  const u = await requireUser("order:create");
  return saveCart(u, await parseBody(req, cartSchema));
});
