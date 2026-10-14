import { availableQuantity, type PharmacyInventory, type StockAllocation } from "@/lib/types";
import { conflict } from "@/server/errors";
import { db } from "@/server/store";

/**
 * Inventory with reservation.
 *
 *   availableQuantity = stockQuantity - reservedQuantity
 *
 *   checkout  → reserve()   reservedQuantity += n           (the units are promised, still on the shelf)
 *   confirmed → consume()   stockQuantity -= n, reserved -= n (the pharmacy accepted the order)
 *   cancelled before confirm → release()  reservedQuantity -= n
 *   cancelled after confirm  → restock()  stockQuantity += n   (units go back on the shelf)
 *
 * Every call works on the exact batches recorded in the order's `stockAllocations`, so releasing or restocking
 * can never touch a different batch than the one that was reserved. All functions are synchronous: in a single Node
 * process nothing can interleave between the availability check and the reservation, so two orders cannot both take
 * the last unit. Callers that touch several collections wrap the work in `atomically()` (see tx.ts).
 */

const now = () => new Date().toISOString();

/** Valid (unexpired, available) batches for one pharmacy + medicine, earliest expiry first (FEFO). */
export function validBatches(pharmacyId: string, medicineId: string, at = Date.now()): PharmacyInventory[] {
  return db()
    .inventory.filter((i) => i.pharmacyId === pharmacyId && i.medicineId === medicineId && availableQuantity(i) > 0 && Date.parse(i.expiry) > at)
    .sort((a, b) => Date.parse(a.expiry) - Date.parse(b.expiry));
}

/** Pharmacy-specific availability: units that can still be promised, and the price of the batch that would ship first. */
export function stockFor(pharmacyId: string, medicineId: string) {
  const batches = validBatches(pharmacyId, medicineId);
  if (!batches.length) return undefined;
  return {
    quantity: batches.reduce((s, b) => s + availableQuantity(b), 0),
    sellingPrice: batches[0].sellingPrice,
    mrp: batches[0].mrp,
    updatedAt: batches.map((b) => b.lastUpdatedAt).sort().at(-1)!,
  };
}

/** Promises stock FEFO across batches. Throws (and changes nothing) when any line cannot be fully reserved. */
export function reserve(pharmacyId: string, lines: { medicineId: string; quantity: number; name?: string }[]): StockAllocation[] {
  for (const l of lines) {
    const have = validBatches(pharmacyId, l.medicineId).reduce((s, b) => s + availableQuantity(b), 0);
    if (have < l.quantity) throw conflict(`${l.name ?? "A medicine"} is no longer available in the quantity needed`);
  }
  const taken: StockAllocation[] = [];
  for (const l of lines) {
    let need = l.quantity;
    for (const b of validBatches(pharmacyId, l.medicineId)) {
      const take = Math.min(availableQuantity(b), need);
      b.reservedQuantity += take;
      b.lastUpdatedAt = now();
      taken.push({ inventoryId: b.id, quantity: take });
      need -= take;
      if (!need) break;
    }
  }
  return taken;
}

const row = (id: string) => db().inventory.find((i) => i.id === id);

/** Order confirmed: the reserved units leave the shelf for good. */
export function consume(allocations: StockAllocation[]) {
  for (const a of allocations) {
    const b = row(a.inventoryId);
    if (!b) continue;
    b.stockQuantity = Math.max(0, b.stockQuantity - a.quantity);
    b.reservedQuantity = Math.max(0, b.reservedQuantity - a.quantity);
    b.lastUpdatedAt = now();
  }
}

/** Order failed / cancelled / expired before confirmation: the promise is withdrawn. */
export function release(allocations: StockAllocation[]) {
  for (const a of allocations) {
    const b = row(a.inventoryId);
    if (!b) continue;
    b.reservedQuantity = Math.max(0, b.reservedQuantity - a.quantity);
    b.lastUpdatedAt = now();
  }
}

/** Order cancelled after it was confirmed (stock already consumed): units go back on the shelf. */
export function restock(allocations: StockAllocation[]) {
  for (const a of allocations) {
    const b = row(a.inventoryId);
    if (!b) continue;
    b.stockQuantity += a.quantity;
    b.lastUpdatedAt = now();
  }
}
