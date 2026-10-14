import { handle, paginate, requireUser } from "@/server/http";
import { listPharmacyRows } from "@/server/features/admin/admin.service";

export const GET = handle(async (req: Request) => {
  await requireUser("admin:read");
  return paginate(listPharmacyRows(), req.url, {
    sortable: { name: (p) => p.name.toLowerCase(), orders: (p) => p.orders, revenue: (p) => p.revenue, rating: (p) => p.rating },
    filters: { verification: (p) => p.verification, pincode: (p) => p.pincode },
    search: (p) => `${p.name} ${p.drugLicense} ${p.pincode}`,
    defaultSort: "name:asc",
  });
});
