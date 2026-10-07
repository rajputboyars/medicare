import { createOrderSchema } from "@/lib/validation";
import { handle, limit, parseBody, requireUser } from "@/server/http";
import { createOrder, listOrdersFor, userSafeOrder } from "@/server/services/orders";

export const GET = handle(async () => {
  const u = await requireUser("order:create");
  return listOrdersFor(u).map((o) => userSafeOrder(o, u));
});

export const POST = handle(async (req: Request) => {
  const u = await requireUser("order:create");
  await limit("order", 20, 60 * 60_000, u.id);
  return userSafeOrder(createOrder(u, await parseBody(req, createOrderSchema)), u);
});
