import { inventoryItemSchema } from "@/lib/validation";
import { handle, paginate, parseBody, requireUser, WithMessage } from "@/server/http";
import { listInventory, upsertInventory } from "@/server/features/pharmacy/pharmacy.service";

/** This pharmacy's stock. ?low=true · ?expiringSoon=true · ?q=name · ?sort=name:asc|stockQuantity:asc|expiry:asc */
export const GET = handle(async (req: Request) => {
  const u = await requireUser("inventory:manage");
  return paginate(listInventory(u), req.url, {
    sortable: { name: (r) => r.name.toLowerCase(), stockQuantity: (r) => r.stockQuantity, availableQuantity: (r) => r.availableQuantity, expiry: (r) => r.expiry, lastUpdatedAt: (r) => r.lastUpdatedAt },
    filters: { low: (r) => String(r.low), expiringSoon: (r) => String(r.expiringSoon) },
    search: (r) => `${r.name} ${r.brand} ${r.generic}`,
    defaultSort: "name:asc", defaultLimit: 100,
  });
});

export const POST = handle(async (req: Request) => {
  const u = await requireUser("inventory:manage");
  return new WithMessage(upsertInventory(u, await parseBody(req, inventoryItemSchema)), "Stock saved", 201);
});
