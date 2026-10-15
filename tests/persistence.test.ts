/**
 * Integration test: needs a MongoDB (docker compose up -d). Uses a separate database, and is skipped automatically
 * when MongoDB is not reachable so `npm test` still works anywhere.
 */
import mongoose from "mongoose";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

process.env.MONGODB_URI = process.env.MONGODB_TEST_URI ?? "mongodb://127.0.0.1:27017/medicare_test";

async function reachable(): Promise<boolean> {
  try {
    const c = await mongoose.createConnection(process.env.MONGODB_URI!, { serverSelectionTimeoutMS: 1500 }).asPromise();
    await c.close();
    return true;
  } catch {
    return false;
  }
}

const up = await reachable();

describe.skipIf(!up)("MongoDB persistence", () => {
  let P: typeof import("@/server/persistence");
  let S: typeof import("@/server/store");
  let seedMod: typeof import("@/server/seed");

  beforeAll(async () => {
    P = await import("@/server/persistence");
    S = await import("@/server/store");
    seedMod = await import("@/server/seed");
    await P.resetMongoStore();
  }, 60_000);

  afterAll(async () => {
    await mongoose.disconnect();
  });

  const strip = (v: unknown): unknown => JSON.parse(JSON.stringify(v, (_k, x) => (x instanceof Uint8Array ? Array.from(x).join(",") : x)));
  const byId = <T extends { id: string }>(xs: T[]) => [...xs].sort((a, b) => a.id.localeCompare(b.id));

  /** Which fields differ between what we wrote and what we read back (first 6), to make a failing schema easy to fix. */
  const differingFields = (a: { id: string }[], b: { id: string }[]) => {
    const out = new Set<string>();
    for (const x of a) { const y = b.find((r) => r.id === x.id) as Record<string, unknown> | undefined; const xs = x as unknown as Record<string, unknown>; for (const k of new Set([...Object.keys(xs), ...Object.keys(y ?? {})])) if (JSON.stringify(xs[k]) !== JSON.stringify(y?.[k])) out.add(k); }
    return [...out].slice(0, 6);
  };

  it("every collection round-trips exactly (schemas lose nothing)", async () => {
    const expected = S.db();
    const loaded = await P.__testing.loadAll();
    const mismatched: string[] = [];
    let first: unknown;
    for (const key of Object.keys(expected) as (keyof typeof expected)[]) {
      if (key === "files") {
        expect([...loaded.files.keys()].sort()).toEqual([...expected.files.keys()].sort());
        for (const [k, f] of expected.files) expect(Array.from(loaded.files.get(k)!.bytes)).toEqual(Array.from(f.bytes));
        continue;
      }
      const a = byId(expected[key] as unknown as { id: string }[]);
      const b = byId(loaded[key] as unknown as { id: string }[]);
      try { expect(strip(b), `collection ${String(key)}`).toEqual(strip(a)); } catch (e) { mismatched.push(String(key) + " [" + differingFields(a, b).join(", ") + "]"); if (!first) first = e; }
    }
    // Report every collection that differs, not just the first one
    if (first) { console.error("collections that do not round-trip:", mismatched.join(", ")); throw first; }
  });

  it("keeps secrets that are select:false (password hashes, OTPs, file keys)", async () => {
    const loaded = await P.__testing.loadAll();
    expect(loaded.users.every((u) => (u.passwordHash === undefined || u.passwordHash.startsWith("$2")))).toBe(true);
    expect(loaded.deliveries.every((d) => d.otpNonce.length > 8 && /^[0-9a-f]{64}$/.test(d.pickupOtpHash) && /^[0-9a-f]{64}$/.test(d.deliveryOtpHash))).toBe(true);
    expect(JSON.stringify(loaded.deliveries)).not.toMatch(/"(pickupOtp|deliveryOtp)"/); // no plain code anywhere
    expect(loaded.prescriptions.every((p) => p.fileKey.length > 3)).toBe(true);
  });

  it("writes only what changed, survives a 'restart', and handles deletes", async () => {
    const { createOrder, advanceAsPharmacy } = await import("@/server/features/orders/orders.service");
    const { MED } = seedMod;
    const o = createOrder({ id: "u_1", name: "Asha", role: "CUSTOMER" }, { pharmacyId: "ph_1", addressId: "ad_1", deliveryType: "NORMAL", paymentMethod: "COD", items: [{ medicineId: MED.PARACETAMOL, quantity: 2 }] });
    advanceAsPharmacy({ id: "u_rx", name: "K", role: "PHARMACIST", partnerId: "ph_1" }, o.id, "confirm");
    const r1 = await P.__testing.flushNow();
    expect(r1.written).toBeGreaterThan(0);
    expect(r1.written).toBeLessThan(25); // order, items, payment, inventory batch, notification… not the whole database
    const r2 = await P.__testing.flushNow();
    expect(r2).toEqual({ written: 0, deleted: 0 }); // nothing changed → nothing written

    const reloaded = await P.__testing.loadAll(); // what a restarted server would see
    const same = reloaded.orders.find((x) => x.id === o.id)!;
    expect(same.status).toBe("CONFIRMED");
    expect(same.items).toHaveLength(1);
    expect(same.stockState).toBe("CONSUMED");
    expect(same.statusHistory.map((h) => h.status)).toEqual(o.statusHistory.map((h) => h.status)); // timeline comes back from the OrderStatusHistory collection
    expect(strip(same)).toEqual(strip(o));

    S.db().carts.push({ id: "c1", userId: "u_1", pharmacyId: "ph_1", items: [{ medicineId: MED.PARACETAMOL, quantity: 1 }], updatedAt: new Date().toISOString() });
    await P.__testing.flushNow();
    S.db().carts = [];
    expect((await P.__testing.flushNow()).deleted).toBe(1);
    expect((await P.__testing.loadAll()).carts).toHaveLength(0);
  });
});
