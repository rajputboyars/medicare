import { handle, paginate, requireUser } from "@/server/http";
import { listMatchReviews } from "@/server/features/inventory/import.service";

/** Inventory lines whose medicine is not in the catalogue yet, waiting for an admin to match, create or reject. */
export const GET = handle(async (req: Request) => {
  await requireUser("admin:read");
  return paginate(listMatchReviews(), req.url, {
    sortable: { createdAt: (r) => r.createdAt },
    filters: { status: (r) => r.status, pharmacyId: (r) => r.pharmacyId },
    search: (r) => `${r.input.medicineName} ${r.input.genericName ?? ""} ${r.pharmacyName ?? ""}`,
    defaultSort: "createdAt:asc", defaultLimit: 50,
  });
});
