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

  it("every collection round-trips exactly (schemas lose nothing)", async () => {
    const expected = S.db();
    const loaded = await P.__testing.loadAll();
    for (const key of Object.keys(expected) as (keyof typeof expected)[]) {
      if (key === "files") {
        expect([...loaded.files.keys()].sort()).toEqual([...expected.files.keys()].sort());
        for (const [k, f] of expected.files) expect(Array.from(loaded.files.get(k)!.bytes)).toEqual(Array.from(f.bytes));
        continue;
      }
      const a = byId(expected[key] as unknown as { id: string }[]);
      const b = byId(loaded[key] as unknown as { id: string }[]);
      expect(strip(b), `collection ${String(key)}`).toEqual(strip(a));
    }
  });

  it("keeps secrets that are select:false (password hashes, OTPs, file keys)", async () => {
    const loaded = await P.__testing.loadAll();
    expect(loaded.users.every((u) => u.passwordHash.startsWith("$2"))).toBe(true);
    expect(loaded.orders.every((o) => /^\d{4}$/.test(o.deliveryOtp) && /^\d{4}$/.test(o.pickupOtp))).toBe(true);
    expect(loaded.prescriptions.every((p) => p.fileKey.length > 3)).toBe(true);
  });

  it("writes only what changed, survives a 'restart', and handles deletes", async () => {
    const { createOrder, advanceAsPharmacy } = await import("@/server/services/orders");
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
    expect(same.stockReserved).toBe(true);
    expect(strip(same)).toEqual(strip(o));

    S.db().carts.push({ id: "c1", userId: "u_1", pharmacyId: "ph_1", items: [{ medicineId: MED.PARACETAMOL, quantity: 1 }], updatedAt: new Date().toISOString() });
    await P.__testing.flushNow();
    S.db().carts = [];
    expect((await P.__testing.flushNow()).deleted).toBe(1);
    expect((await P.__testing.loadAll()).carts).toHaveLength(0);
  });
});
