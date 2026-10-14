import { createOrderSchema } from "@/lib/validation";
import { handle, limit, paginate, parseBody, requireUser, WithMessage } from "@/server/http";
import { createOrder, expireUnpaidOrders, listOrdersFor, userSafeOrder } from "@/server/features/orders/orders.service";

/** My orders. ?status=PENDING,CONFIRMED · ?sort=createdAt:desc|total:asc · ?q=MC-123 · ?page=&limit= */
export const GET = handle(async (req: Request) => {
  const u = await requireUser("order:create");
  expireUnpaidOrders();
  return paginate(listOrdersFor(u).map((o) => userSafeOrder(o, u)), req.url, {
    sortable: { createdAt: (o) => o.createdAt, total: (o) => o.total, status: (o) => o.status },
    filters: { status: (o) => o.status, paymentStatus: (o) => o.paymentStatus },
    search: (o) => `${o.code} ${o.items.map((i) => i.name).join(" ")}`,
    defaultSort: "createdAt:desc", defaultLimit: 100,
  });
});

/**
 * Place an order. The body carries ONLY choices (pharmacy, address, medicine ids and quantities, payment method).
 * Prices, totals, stock, status and payment status are decided on the server and cannot be sent by the client.
 */
export const POST = handle(async (req: Request) => {
  const u = await requireUser("order:create");
  await limit("order", 20, 60 * 60_000, u.id);
  return new WithMessage(userSafeOrder(createOrder(u, await parseBody(req, createOrderSchema)), u), "Order placed", 201);
});
