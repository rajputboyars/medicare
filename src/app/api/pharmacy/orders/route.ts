import { handle, paginate, requireUser } from "@/server/http";
import { expireUnpaidOrders, pharmacyOrders, pharmacyOrderView } from "@/server/features/orders/orders.service";

/** This pharmacy's orders only. ?status=PENDING,CONFIRMED · ?sort=createdAt:desc · ?q= · ?page=&limit= */
export const GET = handle(async (req: Request) => {
  const u = await requireUser("order:read:pharmacy");
  expireUnpaidOrders();
  return paginate(pharmacyOrders(u).map(pharmacyOrderView), req.url, {
    sortable: { createdAt: (o) => o.createdAt, total: (o) => o.total, status: (o) => o.status },
    filters: { status: (o) => o.status, deliveryType: (o) => o.deliveryType },
    search: (o) => `${o.code} ${o.patient.name}`,
    defaultSort: "createdAt:desc", defaultLimit: 100,
  });
});
