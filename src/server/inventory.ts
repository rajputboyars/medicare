import { conflict } from "./errors";
import { db } from "./store";
import type { PharmacyInventory } from "@/lib/types";

/** Valid (unexpired, in-stock) batches for one pharmacy + medicine, earliest expiry first (FEFO). */
export function validBatches(pharmacyId: string, medicineId: string, now = Date.now()): PharmacyInventory[] {
  return db()
    .inventory.filter((i) => i.pharmacyId === pharmacyId && i.medicineId === medicineId && i.quantity > 0 && Date.parse(i.expiry) > now)
    .sort((a, b) => Date.parse(a.expiry) - Date.parse(b.expiry));
}

/** Pharmacy-specific availability: total quantity across valid batches and the price of the batch that would ship first. */
export function stockFor(pharmacyId: string, medicineId: string) {
  const batches = validBatches(pharmacyId, medicineId);
  if (!batches.length) return undefined;
  return { quantity: batches.reduce((s, b) => s + b.quantity, 0), sellingPrice: batches[0].sellingPrice, mrp: batches[0].mrp };
}

/** Takes stock FEFO across batches. Throws (and changes nothing) when any line cannot be fully reserved. */
export function reserve(pharmacyId: string, lines: { medicineId: string; quantity: number; name?: string }[]) {
  for (const l of lines) {
    const have = validBatches(pharmacyId, l.medicineId).reduce((s, b) => s + b.quantity, 0);
    if (have < l.quantity) throw conflict(`${l.name ?? "A medicine"} is no longer available in the quantity needed`);
  }
  for (const l of lines) {
    let need = l.quantity;
    for (const b of validBatches(pharmacyId, l.medicineId)) {
      const take = Math.min(b.quantity, need);
      b.quantity -= take;
      need -= take;
      if (!need) break;
    }
  }
}

/** Puts reserved stock back (order cancelled before delivery). */
export function release(pharmacyId: string, lines: { medicineId: string; quantity: number }[]) {
  for (const l of lines) {
    const rows = db().inventory.filter((i) => i.pharmacyId === pharmacyId && i.medicineId === l.medicineId).sort((a, b) => Date.parse(b.expiry) - Date.parse(a.expiry));
    if (rows[0]) rows[0].quantity += l.quantity;
  }
}
