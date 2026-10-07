import { inventoryItemSchema } from "@/lib/validation";
import { handle, parseBody, requireUser } from "@/server/http";
import { listInventory, upsertInventory } from "@/server/services/pharmacy";

export const GET = handle(async () => listInventory(await requireUser("inventory:manage")));
export const POST = handle(async (req: Request) => {
  const u = await requireUser("inventory:manage");
  return upsertInventory(u, await parseBody(req, inventoryItemSchema));
});
