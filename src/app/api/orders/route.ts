import { createOrderSchema } from "@/lib/validation";
import { handle, limit, paginate, parseBody, requireUser, WithMessage } from "@/server/http";
import { idempotencyKeyFrom } from "@/server/idempotency";
import { expireUnpaidOrders, listOrdersFor, placeOrder, userSafeOrder } from "@/server/features/orders/orders.service";

/** My orders. ?status=PENDING,CONFIRMED · ?sort=createdAt:desc|total:asc · ?q=MC-123 · ?page=&limit= */
export const GET = handle(async (req: Request) => {
  const u = await requireUser("order:create");
  expireUnpaidOrders();
  return paginate(listOrdersFor(u).map((o) => userSafeOrder(o, u)), req.url, {
    sortable: { createdAt: (o) => o.createdAt, total: (o) => o.total, status: (o) => o.status },
    filters: { status: (o) => o.status, paymentStatus: (o) => o.paymentStatus },
    search: (o) => o.code + " " + o.items.map((i) => i.name).join(" "),
    defaultSort: "createdAt:desc", defaultLimit: 100,
  });
});

/**
 * Place an order. The body carries ONLY choices (pharmacy, address, medicine ids and quantities, payment method).
 * Prices, fees, totals, stock, status and payment status are decided on the server and cannot be sent by the client.
 * Send an Idempotency-Key header (any unique text, 8 to 80 characters) so a double tap or a retry returns the first order.
 */
export const POST = handle(async (req: Request) => {
  const u = await requireUser("order:create");
  await limit("order", 20, 60 * 60_000, u.id);
  const key = idempotencyKeyFrom(req);
  const { order, replayed } = placeOrder(u, await parseBody(req, createOrderSchema), key);
  return new WithMessage(userSafeOrder(order, u), replayed ? "This order was already placed" : "Order placed", replayed ? 200 : 201);
});
