import { handle, paginate, requireUser } from "@/server/http";
import { openRequestsForPharmacy } from "@/server/features/medicine-requests/requests.service";

export const GET = handle(async (req: Request) => {
  const u = await requireUser("inventory:manage");
  return paginate(openRequestsForPharmacy(u), req.url, {
    sortable: { createdAt: (r) => r.createdAt, distanceKm: (r) => r.distanceKm, medicine: (r) => r.medicineQuery.toLowerCase() },
    filters: { status: (r) => r.status },
    search: (r) => r.medicineQuery,
    defaultSort: "createdAt:desc", defaultLimit: 100,
  });
});
