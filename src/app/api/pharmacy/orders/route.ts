import { handle, requireUser } from "@/server/http";
import { pharmacyOrders, pharmacyOrderView } from "@/server/services/orders";

export const GET = handle(async () => {
  const u = await requireUser("order:read:pharmacy");
  return pharmacyOrders(u).map(pharmacyOrderView).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
});
