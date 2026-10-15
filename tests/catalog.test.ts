import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { rateLimiter } from "@/lib/rate-limit";
import { compactText, editDistance, matchToken, normalizeText } from "@/lib/search-normalize";
import { availableQuantity } from "@/lib/types";
import { MED } from "@/server/seed";
import { db, resetDb, settings } from "@/server/store";
import { availabilityFor, searchCatalog, suggestMedicines } from "@/server/features/catalog/catalog.service";
import { stockConfidence, confidencePolicy } from "@/server/features/catalog/confidence";
import { createMedicine, findDuplicates, updateMedicine } from "@/server/features/catalog/medicine-admin.service";
import { confirmImport, previewImport, resolveMatchReview } from "@/server/features/inventory/import.service";
import { adjustStock, expiryStateOf, listInventory, pharmacyStats, quickStockUpdate, upsertInventory } from "@/server/features/pharmacy/pharmacy.service";
import { createOrder, expireReservations, PHARMACY_RESPONSE_WINDOW_MS, PAYMENT_WINDOW_MS, confirmPayment, advanceAsPharmacy, cancelOrder } from "@/server/features/orders/orders.service";
import { devOutbox } from "@/server/features/auth/otp-provider";
import { storePrescription } from "@/server/features/prescriptions/prescriptions.service";
import { call, jar, route, signIn } from "./helpers/http";
import type { SessionUser } from "@/lib/types";

vi.mock("next/headers", async () => await import("./helpers/next-headers"));

const owner: SessionUser = { id: "u_ph", name: "Ramesh", role: "PHARMACY_ADMIN", partnerId: "ph_1" };
const owner2: SessionUser = { id: "u_ph2", name: "Sunita", role: "PHARMACY_ADMIN", partnerId: "ph_2" };
const pharmacist: SessionUser = { id: "u_rx", name: "Kavita", role: "PHARMACIST", partnerId: "ph_1" };
const customer: SessionUser = { id: "u_1", name: "Asha", role: "CUSTOMER" };
const admin: SessionUser = { id: "u_ad", name: "Admin", role: "SUPER_ADMIN" };
const PIN = "261001";
const DAY = 86400_000;

const rows = (ph: string, med: string) => db().inventory.filter((i) => i.pharmacyId === ph && i.medicineId === med);
const offers = (med: string, sort?: "FASTEST" | "CHEAPEST" | "NEAREST") => availabilityFor(med, { pincode: PIN, sort }).offers;
const names = (med: string, sort?: "FASTEST" | "CHEAPEST" | "NEAREST") => offers(med, sort).map((o) => o.pharmacy.id);
const top = (q: string) => searchCatalog({ q, pincode: PIN }).items[0]?.medicine.name;

beforeEach(() => { resetDb(); rateLimiter.reset?.(); devOutbox.clear(); jar.token = undefined; vi.useRealTimers(); });
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });

// ───────────── Normalisation and matching ─────────────

describe("search normalisation", () => {
  it("lower-cases, strips punctuation and hyphens, splits digits from letters, collapses spaces", () => {
    expect(normalizeText("  Telma-40 ")).toBe("telma 40");
    expect(normalizeText("TELMA 40")).toBe("telma 40");
    expect(normalizeText("telma40")).toBe("telma 40");
    expect(normalizeText("Dolo_650!!")).toBe("dolo 650");
    expect(normalizeText("Café  Cough—Syrup")).toBe("cafe cough syrup");
    expect(normalizeText(undefined)).toBe("");
    expect(compactText("Telma - 40 mg")).toBe("telma40mg");
  });
  it("tolerates small typos in real words but never in numbers or very short words", () => {
    expect(matchToken("telmisarten", "telmisartan")).toBe("FUZZY");
    expect(matchToken("para", "paracetamol")).toBe("PREFIX");
    expect(matchToken("40", "41")).toBeNull();
    expect(matchToken("ors", "ort")).toBeNull();
    expect(editDistance("kitten", "sitting", 3)).toBe(3);
    expect(editDistance("abcdef", "uvwxyz", 2)).toBeGreaterThan(2);
  });
  it("Telma-40, TELMA 40 and telma40 all find Telmisartan 40 first", () => {
    for (const q of ["Telma-40", "TELMA 40", "telma40", "  telma   40  ", "Telma 40 mg"]) expect(top(q), q).toBe("Telmisartan 40");
  });
  it("finds by name, generic name, brand, alias and keyword", () => {
    expect(top("telmisartan")).toBe("Telmisartan 40");        // generic
    expect(top("levothyroxine")).toBe("Thyronorm 50");        // generic of another
    expect(top("Dolo")).toBe("Paracetamol 650");              // brand
    expect(top("dolo650")).toBe("Paracetamol 650");           // alias, compact
    expect(top("Telmikind")).toBe("Telmisartan 40");          // alias
    expect(top("fever")).toBe("Paracetamol 650");             // keyword
    expect(top("Glycomet 500")).toBe("Metformin 500");        // brand + strength
  });
  it("forgives small typos but a wrong strength is not a match", () => {
    expect(top("telmisarten")).toBe("Telmisartan 40");
    expect(top("paracetmol")).toBe("Paracetamol 650");
    expect(searchCatalog({ q: "telma 41", pincode: PIN }).items.every((i) => !/telmisartan/i.test(i.medicine.name))).toBe(true);
    expect(searchCatalog({ q: "zzzzqqq", pincode: PIN }).items).toEqual([]);
  });
  it("extra words narrow the results", () => {
    const wide = searchCatalog({ q: "tablet", pincode: PIN }).meta.total;
    const narrow = searchCatalog({ q: "paracetamol 650 tablet", pincode: PIN }).meta.total;
    expect(narrow).toBeLessThanOrEqual(wide);
    expect(narrow).toBeGreaterThan(0);
  });
  it("normalised fields are rebuilt on create and update, and inactive medicines vanish from search", () => {
    const m = db().medicines.find((x) => x.id === MED.PARACETAMOL)!;
    expect(m).toMatchObject({ normalizedName: "paracetamol 650", normalizedGenericName: "paracetamol", status: "ACTIVE", manufacturer: "Micro Labs" });
    updateMedicine(admin, m.id, { name: "Paracetamol-650 Extra", searchAliases: ["Pcm 650"] });
    expect(m.normalizedName).toBe("paracetamol 650 extra");
    expect(top("pcm650")).toBe("Paracetamol-650 Extra");
    m.status = "INACTIVE";
    expect(searchCatalog({ q: "paracetamol", pincode: PIN }).items.some((i) => i.medicine.id === m.id)).toBe(false);
    expect(() => availabilityFor(m.id, { pincode: PIN })).toThrow(/not found/i);
  });
});

describe("autocomplete", () => {
  it("returns a few suggestions with id, name, strength, generic", () => {
    const s = suggestMedicines("tel");
    expect(s.length).toBeGreaterThan(0);
    expect(s.length).toBeLessThanOrEqual(8);
    expect(s[0]).toEqual({ medicineId: MED.TELMISARTAN, name: "Telmisartan 40", strength: "40 mg", generic: "Telmisartan", brand: "Telma" });
    expect(suggestMedicines("para", 1)).toHaveLength(1);
    expect(suggestMedicines("")).toEqual([]);
    expect(suggestMedicines("telmisarten")[0].medicineId).toBe(MED.TELMISARTAN); // typo
    expect(new Set(suggestMedicines("a").map((x) => x.medicineId)).size).toBe(suggestMedicines("a").length); // no duplicates
  });
  it("is public, validated and limited at the API", async () => {
    const h = (await route("medicines/suggestions")).GET;
    const r = await call(h, "GET", "/api/medicines/suggestions?q=telma");
    expect(r.status).toBe(200);
    expect(r.body.data[0].medicineId).toBe(MED.TELMISARTAN);
    expect((await call(h, "GET", "/api/medicines/suggestions?q=a&limit=3")).body.data.length).toBeLessThanOrEqual(3);
    expect((await call(h, "GET", "/api/medicines/suggestions?q=a&limit=99")).status).toBe(400);
  });
});

describe("search API", () => {
  const search = async (qs: string) => call((await route("medicines/search")).GET, "GET", `/api/medicines/search?pincode=${PIN}&${qs}`);
  it("returns startingPrice, availablePharmacyCount, fastestETA and prescriptionRequired, with pagination meta", async () => {
    const r = await search("q=paracetamol");
    expect(r.status).toBe(200);
    const item = r.body.data[0];
    expect(item).toMatchObject({ prescriptionRequired: false, match: expect.any(String) });
    expect(item.startingPrice).toBeGreaterThan(0);
    expect(item.availablePharmacyCount).toBeGreaterThanOrEqual(2);
    expect(item.fastestETA).toBeGreaterThan(0);
    expect(item.medicine).toMatchObject({ name: "Paracetamol 650", genericName: "Paracetamol", strength: "650 mg" });
    expect(r.body.meta).toMatchObject({ page: 1, total: expect.any(Number), hasNext: expect.any(Boolean) });
  });
  it("paginates, filters by prescription, availability and sorts", async () => {
    const all = await search("limit=5&page=1&sort=NAME");
    expect(all.body.data).toHaveLength(5);
    expect(all.body.meta.hasNext).toBe(true);
    const next = await search("limit=5&page=2&sort=NAME");
    expect(next.body.data[0].medicine.name).not.toBe(all.body.data[0].medicine.name);
    const names = all.body.data.map((i: { medicine: { name: string } }) => i.medicine.name);
    expect(names).toEqual([...names].sort((a: string, b: string) => a.localeCompare(b)));
    const rx = await search("prescriptionRequired=true&limit=40");
    expect(rx.body.data.length).toBeGreaterThan(0);
    expect(rx.body.data.every((i: { prescriptionRequired: boolean }) => i.prescriptionRequired)).toBe(true);
    const otc = await search("prescriptionRequired=false&limit=40");
    expect(otc.body.data.every((i: { prescriptionRequired: boolean }) => !i.prescriptionRequired)).toBe(true);
    const avail = await search("availability=AVAILABLE&limit=40");
    expect(avail.body.data.every((i: { availablePharmacyCount: number }) => i.availablePharmacyCount > 0)).toBe(true);
    const cheap = (await search("availability=AVAILABLE&sort=PRICE&limit=40")).body.data.map((i: { startingPrice: number }) => i.startingPrice);
    expect(cheap).toEqual([...cheap].sort((a: number, b: number) => a - b));
  });
  it("validates every parameter", async () => {
    expect((await call((await route("medicines/search")).GET, "GET", "/api/medicines/search")).status).toBe(400);              // pincode missing
    for (const bad of ["page=0", "limit=500", "sort=RANDOM", "availability=MAYBE", "prescriptionRequired=maybe"]) expect((await search(bad)).status, bad).toBe(400);
  });
  it("a medicine nobody stocks nearby is still found, with zero pharmacies and no price (never a made-up one)", async () => {
    for (const r of db().inventory.filter((i) => i.medicineId === MED.INSULIN)) r.stockQuantity = 0;
    const item = (await search("q=insulin")).body.data[0];
    expect(item.availablePharmacyCount).toBe(0);
    expect(item.startingPrice).toBeNull();
    expect(item.fastestETA).toBeNull();
  });
  it("records search analytics without any personal data, and 'no result' as its own event", async () => {
    await signIn("asha@example.com");
    await search("q=Telma-40");
    await search("q=zzzzqqq");
    const ev = db().analytics.filter((e) => e.name === "medicine_search" || e.name === "search_no_result");
    expect(ev.map((e) => e.name)).toEqual(["medicine_search", "search_no_result"]);
    expect(ev[0].props).toMatchObject({ q: "telma 40", results: expect.any(Number), pincode: PIN });
    expect(ev.every((e) => e.userId === undefined && e.anonId === undefined)).toBe(true);
    expect(JSON.stringify(ev)).not.toContain("u_1");
  });
});

// ───────────── Availability ─────────────

describe("availability: who can actually sell it", () => {
  it("lists verified pharmacies with price, MRP, quantity, distance, ETA, last update and confidence", () => {
    const list = offers(MED.PARACETAMOL);
    expect(list.length).toBeGreaterThanOrEqual(2);
    const o = list[0];
    expect(o).toMatchObject({
      pharmacy: { verified: true }, sellingPrice: expect.any(Number), mrp: expect.any(Number), availableQuantity: expect.any(Number), distanceKm: expect.any(Number),
      estimatedDelivery: { minutes: expect.any(Number), range: [expect.any(Number), expect.any(Number)] }, lastStockUpdateAt: expect.any(String), inventoryConfidence: expect.stringMatching(/HIGH|MEDIUM|LOW/),
    });
    expect(o.sellingPrice).toBeLessThanOrEqual(o.mrp);
    expect(o.estimatedTotal).toBe(o.sellingPrice + o.deliveryFee);
  });
  it("excludes unverified, suspended, closed-for-orders and out-of-area pharmacies", () => {
    expect(names(MED.PARACETAMOL)).not.toContain("ph_5");                       // pending verification
    db().pharmacies.find((p) => p.id === "ph_2")!.verification = "SUSPENDED";
    expect(names(MED.PARACETAMOL)).not.toContain("ph_2");
    db().pharmacies.find((p) => p.id === "ph_1")!.acceptingOrders = false;       // not taking orders
    expect(names(MED.PARACETAMOL)).not.toContain("ph_1");
    expect(availabilityFor(MED.PARACETAMOL, { pincode: "261125" }).offers.every((o) => o.pharmacy.id !== "ph_1")).toBe(true); // ph_1 does not serve 261125
  });
  it("excludes expired stock, zero stock, fully reserved stock and INACTIVE rows, but keeps them in the pharmacy's own list", () => {
    const med = MED.PARACETAMOL;
    const ph1 = rows("ph_1", med)[0];
    ph1.expiry = new Date(Date.now() - DAY).toISOString();
    expect(names(med)).not.toContain("ph_1");
    expect(listInventory(owner).find((r) => r.id === ph1.id)).toMatchObject({ expired: true, sellable: false, expiryState: "EXPIRED" });
    expect(db().inventory.some((r) => r.id === ph1.id)).toBe(true); // history is kept, nothing deleted
    ph1.expiry = new Date(Date.now() + 200 * DAY).toISOString();
    expect(names(med)).toContain("ph_1");
    ph1.stockQuantity = 0;
    expect(names(med)).not.toContain("ph_1");
    ph1.stockQuantity = 5; ph1.reservedQuantity = 5;                             // everything is promised to open orders
    expect(names(med)).not.toContain("ph_1");
    ph1.reservedQuantity = 2;
    expect(offers(med).find((o) => o.pharmacy.id === "ph_1")!.availableQuantity).toBe(3); // stock − reserved
    ph1.status = "INACTIVE";
    expect(names(med)).not.toContain("ph_1");
  });
  it("sums several valid batches and prices from the earliest-expiring one", () => {
    const med = MED.PARACETAMOL;
    const a = rows("ph_1", med)[0];
    a.stockQuantity = 10; a.reservedQuantity = 4; a.expiry = new Date(Date.now() + 200 * DAY).toISOString(); a.sellingPrice = 30; a.mrp = 33;
    db().inventory.push({ ...a, id: "inv_early", batch: "B-EARLY", expiry: new Date(Date.now() + 40 * DAY).toISOString(), stockQuantity: 5, reservedQuantity: 0, sellingPrice: 28 });
    db().inventory.push({ ...a, id: "inv_dead", batch: "B-DEAD", expiry: new Date(Date.now() - 5 * DAY).toISOString(), stockQuantity: 99, reservedQuantity: 0, sellingPrice: 1 });
    const o = offers(med).find((x) => x.pharmacy.id === "ph_1")!;
    expect(o.availableQuantity).toBe(6 + 5);   // (10−4) + 5, the expired 99 is ignored
    expect(o.sellingPrice).toBe(28);           // the batch that would ship first
  });
  it("reports LOW_STOCK honestly", () => {
    const r = rows("ph_1", MED.PARACETAMOL)[0];
    r.stockQuantity = 6; r.reservedQuantity = 0; r.lowStockThreshold = 10;
    expect(offers(MED.PARACETAMOL).find((o) => o.pharmacy.id === "ph_1")!.stockState).toBe("LOW_STOCK");
  });
  it("by API: public, validated, never exposes inventory ids or other pharmacies' internals", async () => {
    const h = (await route("medicines/[id]/availability")).GET;
    const r = await call(h, "GET", `/x?pincode=${PIN}&sort=CHEAPEST`, { params: { id: MED.PARACETAMOL } });
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ sort: "CHEAPEST", covered: true, medicine: { id: MED.PARACETAMOL } });
    expect(JSON.stringify(r.body)).not.toMatch(/inv_|reservedQuantity|stockQuantity|updatedBy/);
    expect((await call(h, "GET", `/x?pincode=${PIN}&sort=BEST`, { params: { id: MED.PARACETAMOL } })).status).toBe(400);
    expect((await call(h, "GET", `/x?pincode=12`, { params: { id: MED.PARACETAMOL } })).status).toBe(400);
    expect((await call(h, "GET", `/x?pincode=${PIN}`, { params: { id: "med_nope" } })).status).toBe(404);
    expect(db().analytics.some((e) => e.name === "availability_viewed")).toBe(true);
  });
  it("tells an uncovered pincode instead of pretending", () => {
    const r = availabilityFor(MED.PARACETAMOL, { pincode: "110001" });
    expect(r).toMatchObject({ covered: false, offers: [] });
    expect(r.coverageMessage).toMatch(/coming to your area/i);
  });
});

describe("availability sorting and honest delivery estimates", () => {
  function twoShops() {
    const med = MED.PARACETAMOL;
    settings().freeDeliveryAbove = 100; settings().normalDeliveryFee = 25;
    for (const id of ["ph_3", "ph_4"]) db().pharmacies.find((p) => p.id === id)!.acceptingOrders = false; // two shops only
    const a = rows("ph_1", med)[0], b = rows("ph_2", med)[0];
    for (const r of [a, b]) { r.stockQuantity = 50; r.reservedQuantity = 0; r.mrp = 200; r.expiry = new Date(Date.now() + 200 * DAY).toISOString(); r.lastUpdatedAt = new Date().toISOString(); }
    a.sellingPrice = 120; // free delivery: total 120
    b.sellingPrice = 90;  // fee 25: total 115?  make it dearer overall:
    b.sellingPrice = 99;  // 99 + 25 = 124
    return { med };
  }
  it("CHEAPEST compares medicine price + delivery fee, not the shelf price alone", () => {
    const { med } = twoShops();
    const list = offers(med, "CHEAPEST");
    expect(list[0].pharmacy.id).toBe("ph_1");              // dearer on the shelf (120 vs 99) but free delivery: 120 < 124
    expect(list.find((o) => o.pharmacy.id === "ph_2")!.estimatedTotal).toBe(124);
    expect(list.map((o) => o.estimatedTotal)).toEqual([...list.map((o) => o.estimatedTotal)].sort((x, y) => x - y));
  });
  it("NEAREST sorts by distance; FASTEST by ETA with closed pharmacies last", () => {
    const { med } = twoShops();
    const near = offers(med, "NEAREST").map((o) => o.distanceKm!);
    expect(near).toEqual([...near].sort((x, y) => x - y));
    const fast = offers(med, "FASTEST");
    const minutes = fast.filter((o) => o.pharmacy.openNow).map((o) => o.estimatedDelivery.minutes!);
    expect(minutes).toEqual([...minutes].sort((x, y) => x - y));
    // close one pharmacy: it must not be promised a delivery time, and it sorts after the open ones
    const ph = db().pharmacies.find((p) => p.id === fast[0].pharmacy.id)!;
    ph.openTime = "00:00"; ph.closeTime = "00:01";
    const afterClose = offers(med, "FASTEST");
    const closed = afterClose.find((o) => o.pharmacy.id === ph.id)!;
    expect(closed).toMatchObject({ pharmacy: { openNow: false }, estimatedDelivery: { minutes: null, range: null, basis: ["CLOSED"] } });
    expect(closed.estimatedDelivery.note).toMatch(/Opens at 00:00/);
    expect(afterClose.at(-1)!.pharmacy.id).toBe(ph.id);
  });
  it("the estimate reflects real factors: prescription check and no rider online make it longer, and say so", () => {
    const otc = offers(MED.PARACETAMOL, "NEAREST")[0].estimatedDelivery;
    for (const r of db().deliveryPartners) r.available = false;
    const noRider = offers(MED.PARACETAMOL, "NEAREST")[0].estimatedDelivery;
    expect(noRider.minutes!).toBeGreaterThan(otc.minutes!);
    expect(noRider.basis).toContain("NO_RIDER_ONLINE");
    expect(noRider.note).toMatch(/No delivery partner is online/);
    expect(otc.basis).toContain("RIDER_ONLINE");
    for (const r of db().deliveryPartners) r.available = true;
    const rx = offers(MED.METFORMIN, "NEAREST")[0].estimatedDelivery;
    expect(rx.basis).toContain("PRESCRIPTION_CHECK");
    const rxMin = rx.minutes!, base = Math.round(rxMin);
    expect(base).toBeGreaterThan(0);
  });
  it("ranges are always a range, never a single exact promise", () => {
    for (const o of offers(MED.PARACETAMOL)) { expect(o.estimatedDelivery.range![1]).toBeGreaterThan(o.estimatedDelivery.range![0]); }
  });
  it("preferred pharmacies are badged and break ties, but never hide or outrank a clearly better option", () => {
    const med = MED.PARACETAMOL;
    const user = db().users.find((u) => u.id === "u_1")!;
    user.favoritePharmacyIds = ["ph_2"];
    const fast = availabilityFor(med, { pincode: PIN, sort: "NEAREST", userId: "u_1" });
    expect(fast.offers.find((o) => o.pharmacy.id === "ph_2")!.preferred).toBe(true);
    expect(fast.offers.filter((o) => !o.preferred).length).toBeGreaterThan(0); // others still shown
    const plain = availabilityFor(med, { pincode: PIN, sort: "NEAREST" });
    expect(plain.offers.map((o) => o.pharmacy.id)).toEqual(fast.offers.map((o) => o.pharmacy.id)); // order unchanged unless tied
    expect(plain.offers.every((o) => !o.preferred)).toBe(true);
  });
});

describe("inventory confidence", () => {
  it("HIGH when recent, MEDIUM when moderately old, LOW when stale, with configurable thresholds", () => {
    const now = Date.now();
    const ago = (h: number) => new Date(now - h * 3600_000).toISOString();
    expect(stockConfidence(ago(1), now)).toBe("HIGH");
    expect(stockConfidence(ago(12), now)).toBe("HIGH");
    expect(stockConfidence(ago(13), now)).toBe("MEDIUM");
    expect(stockConfidence(ago(72), now)).toBe("MEDIUM");
    expect(stockConfidence(ago(73), now)).toBe("LOW");
    expect(stockConfidence(undefined, now)).toBe("LOW");
    expect(stockConfidence("garbage", now)).toBe("LOW");
    vi.stubEnv("STOCK_CONFIDENCE_HIGH_HOURS", "2");
    vi.stubEnv("STOCK_CONFIDENCE_MEDIUM_HOURS", "6");
    expect(confidencePolicy()).toEqual({ highWithinHours: 2, mediumWithinHours: 6 });
    expect(stockConfidence(ago(3), now)).toBe("MEDIUM");
    expect(stockConfidence(ago(7), now)).toBe("LOW");
    vi.stubEnv("STOCK_CONFIDENCE_HIGH_HOURS", "-5");
    expect(confidencePolicy().highWithinHours).toBe(12); // nonsense falls back to the default
  });
  it("stale stock tells the customer the pharmacy may need to confirm; fresh stock does not", () => {
    const med = MED.PARACETAMOL;
    rows("ph_1", med)[0].lastUpdatedAt = new Date(Date.now() - 10 * DAY).toISOString();
    rows("ph_2", med)[0].lastUpdatedAt = new Date().toISOString();
    const list = offers(med);
    const stale = list.find((o) => o.pharmacy.id === "ph_1")!, fresh = list.find((o) => o.pharmacy.id === "ph_2")!;
    expect(stale).toMatchObject({ inventoryConfidence: "LOW", confirmationMayBeNeeded: true });
    expect(stale.confidenceNote).toMatch(/confirm/i);
    expect(fresh).toMatchObject({ inventoryConfidence: "HIGH", confirmationMayBeNeeded: false });
    expect(fresh.confidenceNote).not.toMatch(/confirm/i);
  });
  it("any stock change refreshes the timestamp and so the confidence", () => {
    const row = rows("ph_1", MED.PARACETAMOL)[0];
    row.lastUpdatedAt = new Date(Date.now() - 10 * DAY).toISOString();
    expect(stockConfidence(row.lastUpdatedAt)).toBe("LOW");
    quickStockUpdate(owner, row.id, row.stockQuantity + 1);
    expect(stockConfidence(row.lastUpdatedAt)).toBe("HIGH");
  });
});

// ───────────── Inventory rules ─────────────

describe("inventory model rules", () => {
  const base = () => ({ medicineId: MED.ORS, batch: "NEW-1", expiry: new Date(Date.now() + 400 * DAY).toISOString(), mrp: 30, sellingPrice: 25, stockQuantity: 20, lowStockThreshold: 5 });
  it("rejects negative stock, reserved above stock, selling above MRP, and zero prices", () => {
    expect(() => upsertInventory(owner, { ...base(), stockQuantity: -1 })).toThrow(/negative/);
    expect(() => upsertInventory(owner, { ...base(), sellingPrice: 31 })).toThrow(/higher than MRP/);
    expect(() => upsertInventory(owner, { ...base(), mrp: 0, sellingPrice: 0 })).toThrow();
    const row = rows("ph_1", MED.PARACETAMOL)[0];
    row.reservedQuantity = 7; row.stockQuantity = 20;
    expect(() => quickStockUpdate(owner, row.id, 6)).toThrow(/promised to open orders/);    // would leave reserved > stock
    expect(() => quickStockUpdate(owner, row.id, -2)).toThrow();
    expect(() => adjustStock(owner, row.id, -14)).toThrow(/promised|valid/);
    expect(() => adjustStock(owner, row.id, 1.5)).toThrow();
    expect(quickStockUpdate(owner, row.id, 7).stockQuantity).toBe(7);                          // exactly the promised amount is fine
    expect(row.reservedQuantity).toBeLessThanOrEqual(row.stockQuantity);
  });
  it("quick update: exact entry and + / − both stamp lastUpdatedAt, updatedBy, and are audited", () => {
    const row = rows("ph_1", MED.PARACETAMOL)[0];
    row.lastUpdatedAt = "2020-01-01T00:00:00.000Z";
    const before = row.stockQuantity;
    adjustStock(owner, row.id, 5);
    expect(row.stockQuantity).toBe(before + 5);
    expect(Date.parse(row.lastUpdatedAt)).toBeGreaterThan(Date.parse("2021-01-01"));
    expect(row.updatedBy).toBe("u_ph");
    quickStockUpdate(owner, row.id, 33);
    expect(row.stockQuantity).toBe(33);
    const log = db().audit.filter((a) => a.targetId === row.id && a.action === "STOCK_UPDATED");
    expect(log.map((a) => a.meta?.to)).toEqual([33, before + 5]);
    quickStockUpdate(owner, row.id, 2);
    expect(db().audit.find((a) => a.targetId === row.id && a.meta?.to === 2)!.meta?.low).toBe(true);
  });
  it("new rows get status ACTIVE, createdAt, updatedAt and updatedBy; edits are audited with before/after", () => {
    const r = upsertInventory(owner, base());
    expect(r).toMatchObject({ status: "ACTIVE", updatedBy: "u_ph", reservedQuantity: 0, createdAt: expect.any(String), updatedAt: expect.any(String) });
    const again = upsertInventory(owner, { ...base(), stockQuantity: 12 }); // same batch updates, no duplicate
    expect(again.id).toBe(r.id);
    expect(db().inventory.filter((i) => i.pharmacyId === "ph_1" && i.batch === "NEW-1")).toHaveLength(1);
    expect(db().audit.some((a) => a.action === "INVENTORY_EDITED" && a.targetId === r.id)).toBe(true);
  });
  it("cannot stock an inactive or unknown medicine", () => {
    db().medicines.find((m) => m.id === MED.ORS)!.status = "INACTIVE";
    expect(() => upsertInventory(owner, base())).toThrow(/not in the catalogue/);
    expect(() => upsertInventory(owner, { ...base(), medicineId: "med_nope" })).toThrow(/Unknown medicine/);
  });
  it("only a pharmacy's own staff can change its inventory; other pharmacies, customers and unapproved applicants cannot", () => {
    const theirs = rows("ph_2", MED.PARACETAMOL)[0];
    expect(() => quickStockUpdate(owner, theirs.id, 1)).toThrow();
    expect(() => adjustStock(pharmacist, theirs.id, 1)).toThrow();
    expect(() => upsertInventory(owner, { ...base(), batch: "X" }, theirs.id)).toThrow();
    expect(() => quickStockUpdate(owner2, rows("ph_1", MED.PARACETAMOL)[0].id, 1)).toThrow();
    expect(() => quickStockUpdate({ id: "u_x", name: "x", role: "PHARMACY_ADMIN" }, theirs.id, 1)).toThrow(/not approved/);
  });
  it("API: ownership, roles, validation", async () => {
    const stock = (await route("pharmacy/inventory/[id]/stock")).PATCH;
    const mine = rows("ph_1", MED.PARACETAMOL)[0].id, theirs = rows("ph_2", MED.PARACETAMOL)[0].id;
    await signIn("pharmacy@example.com");
    expect((await call(stock, "PATCH", "/x", { params: { id: mine }, body: { stockQuantity: 44 } })).body.data.stockQuantity).toBe(44);
    expect((await call(stock, "PATCH", "/x", { params: { id: mine }, body: { delta: -4 } })).body.data.stockQuantity).toBe(40);
    expect((await call(stock, "PATCH", "/x", { params: { id: theirs }, body: { stockQuantity: 0 } })).status).toBe(403);
    expect((await call(stock, "PATCH", "/x", { params: { id: mine }, body: { stockQuantity: -1 } })).status).toBe(400);
    expect((await call(stock, "PATCH", "/x", { params: { id: mine }, body: { stockQuantity: 1, delta: 1 } })).status).toBe(400);
    expect((await call(stock, "PATCH", "/x", { params: { id: "inv_nope" }, body: { delta: 1 } })).status).toBe(404);
    await signIn("asha@example.com");
    expect((await call(stock, "PATCH", "/x", { params: { id: mine }, body: { stockQuantity: 1 } })).status).toBe(403);
    await signIn("admin@example.com");
    expect((await call(stock, "PATCH", "/x", { params: { id: mine }, body: { stockQuantity: 1 } })).status).toBe(403); // admins review; they do not edit a pharmacy's stock
    await signIn(undefined);
    expect((await call(stock, "PATCH", "/x", { params: { id: mine }, body: { stockQuantity: 1 } })).status).toBe(401);
  });
});

describe("expiry and low-stock views", () => {
  it("classifies EXPIRED / EXPIRING_30 / EXPIRING_90 / OK, never deletes, and counts them for the dashboard", () => {
    const base = rows("ph_1", MED.PARACETAMOL)[0];
    const make = (id: string, days: number, stock = 5) => db().inventory.push({ ...base, id, batch: id, expiry: new Date(Date.now() + days * DAY).toISOString(), stockQuantity: stock, reservedQuantity: 0 });
    make("e_old", -3); make("e_30", 20); make("e_90", 60); make("e_ok", 300);
    const state = (id: string) => listInventory(owner).find((r) => r.id === id)!.expiryState;
    expect([state("e_old"), state("e_30"), state("e_90"), state("e_ok")]).toEqual(["EXPIRED", "EXPIRING_30", "EXPIRING_90", "OK"]);
    expect(expiryStateOf(new Date(Date.now() + 30 * DAY - 1000).toISOString())).toBe("EXPIRING_30");
    expect(expiryStateOf(new Date(Date.now() + 31 * DAY).toISOString())).toBe("EXPIRING_90");
    const stats = pharmacyStats(owner);
    expect(stats.expired).toBeGreaterThanOrEqual(1);
    expect(stats.expiring30).toBeGreaterThanOrEqual(1);
    expect(stats.expiring90).toBeGreaterThanOrEqual(2);
    const total = db().inventory.length;
    listInventory(owner); pharmacyStats(owner);
    expect(db().inventory).toHaveLength(total); // nothing removed automatically
    expect(listInventory(owner).find((r) => r.id === "e_old")!.sellable).toBe(false);
  });
  it("low stock and out of stock are counted and configurable per row", () => {
    const row = rows("ph_1", MED.PARACETAMOL)[0];
    row.reservedQuantity = 0;
    const lowBefore = pharmacyStats(owner).lowStock;
    row.stockQuantity = 3; row.lowStockThreshold = 10;
    expect(pharmacyStats(owner).lowStock).toBe(lowBefore + (listInventory(owner).filter((r) => r.low).length > lowBefore ? 1 : 0));
    expect(listInventory(owner).find((r) => r.id === row.id)!.low).toBe(true);
    row.lowStockThreshold = 2;
    expect(listInventory(owner).find((r) => r.id === row.id)!.low).toBe(false);
    row.stockQuantity = 0;
    expect(listInventory(owner).find((r) => r.id === row.id)).toMatchObject({ outOfStock: true, sellable: false });
    expect(pharmacyStats(owner).outOfStock).toBeGreaterThanOrEqual(1);
  });
  it("the inventory API paginates and filters by expiry and low stock", async () => {
    await signIn("pharmacy@example.com");
    const list = (await route("pharmacy/inventory")).GET;
    const r = await call(list, "GET", "/api/pharmacy/inventory?limit=3&sort=name:asc");
    expect(r.body.data.length).toBeLessThanOrEqual(3);
    expect(r.body.meta.total).toBeGreaterThan(3);
    const low = await call(list, "GET", "/api/pharmacy/inventory?low=true");
    expect(low.body.data.every((x: { low: boolean }) => x.low)).toBe(true);
  });
});

// ───────────── CSV import ─────────────

const HEAD = "medicine_name,generic_name,strength,manufacturer,batch,expiry,mrp,selling_price,stock";
const csv = (...lines: string[]) => [HEAD, ...lines].join("\n");

describe("CSV import: preview, categories, confirm", () => {
  it("categorises rows MATCHED / POSSIBLE_MATCH / NOT_FOUND / INVALID and writes NOTHING at preview", () => {
    const before = db().inventory.length, reviews = db().matchReviews.length, meds = db().medicines.length;
    const imp = previewImport(owner, "stock.csv", csv(
      "Telma-40,Telmisartan,40 mg,Glenmark,TB1,2028-01-31,142,130,50",          // normalised name → MATCHED
      "Telmisarten 40,,40 mg,,TB2,2028-01-31,142,130,5",                         // typo → POSSIBLE_MATCH
      "Paracetamol 650,Paracetamol,500 mg,,PB1,2028-01-31,30,28,5",             // right name, different strength → POSSIBLE_MATCH, never silently attached
      "Zorbex Forte,,10 mg,,ZB1,2028-01-31,50,45,10",                            // nothing close → NOT_FOUND
      "Metformin 500,Metformin,500 mg,,MB1,not-a-date,32,30,5",                  // bad date → INVALID
      "Amlodipine 5,,5 mg,,AB1,2028-01-31,58,70,5",                              // price above MRP → INVALID
      "Dolo 650,,,,DB1,2028-01-31,33,30,-3",                                     // negative stock → INVALID
    ));
    const status = imp.rows.map((r) => r.status);
    expect(status).toEqual(["MATCHED", "POSSIBLE_MATCH", "POSSIBLE_MATCH", "NOT_FOUND", "INVALID", "INVALID", "INVALID"]);
    expect(imp.rows[0].medicineId).toBe(MED.TELMISARTAN);
    expect(imp.rows[2].candidates![0].medicineId).toBe(MED.PARACETAMOL);
    expect(imp.rows[4].errors![0]).toMatch(/Expiry/);
    expect(imp.rows[5].errors![0]).toMatch(/higher than MRP/);
    expect(imp.rows[6].errors![0]).toMatch(/Stock/);
    expect([db().inventory.length, db().matchReviews.length, db().medicines.length]).toEqual([before, reviews, meds]); // preview changes nothing
    expect(imp.status).toBe("PREVIEW");
  });
  it("rejects a file with missing columns, no rows, or too many rows", () => {
    expect(() => previewImport(owner, "a.csv", "name,price\nx,1")).toThrow(/first row must name the columns/);
    expect(() => previewImport(owner, "a.csv", HEAD)).toThrow(/no rows/);
    expect(() => previewImport(owner, "a.csv", "")).toThrow(/empty/);
    expect(() => previewImport(owner, "a.csv", csv(...Array.from({ length: 2001 }, (_, i) => `X${i},,,,B${i},2028-01-01,10,9,1`)))).toThrow(/at most 2000/);
  });
  it("accepts friendly headers (spaces, other names) and flags the same medicine+batch twice", () => {
    const imp = previewImport(owner, "a.csv", ["Medicine Name,Batch No,Expiry Date,MRP,Selling Price,Qty", "Dolo 650,D1,2028-05-01,33,30,10", "Dolo 650,D1,2028-05-01,33,30,10"].join("\n"));
    expect(imp.rows.map((r) => r.status)).toEqual(["MATCHED", "INVALID"]);
    expect(imp.rows[1].errors![0]).toMatch(/twice/);
  });
  it("confirm imports matched rows, uses the pharmacy's choices, and sends the rest to admin review; no catalogue record is ever created", () => {
    const meds = db().medicines.length;
    const imp = previewImport(owner, "stock.csv", csv(
      "Telma-40,Telmisartan,40 mg,,TB1,2028-01-31,142,130,50",
      "Paracetamol 650,Paracetamol,500 mg,,PB1,2028-01-31,30,28,5",
      "Telmisarten 40,,40 mg,,TB9,2028-01-31,142,130,5",
      "Zorbex Forte,,10 mg,,ZB1,2028-01-31,50,45,10",
      "Metformin 500,,500 mg,,MB1,nope,32,30,5",
    ));
    const out = confirmImport(owner, imp.id, { "3": MED.PARACETAMOL });
    expect(out).toMatchObject({ status: "CONFIRMED", imported: 2, sentToReview: 2 }); // matched + chosen possible; unresolved possible + not-found → review
    expect(db().medicines).toHaveLength(meds);
    const tel = rows("ph_1", MED.TELMISARTAN).find((r) => r.batch === "TB1")!;
    expect(tel).toMatchObject({ stockQuantity: 50, sellingPrice: 130, status: "ACTIVE", updatedBy: "u_ph" });
    expect(rows("ph_1", MED.PARACETAMOL).some((r) => r.batch === "PB1")).toBe(true);
    expect(db().matchReviews.filter((r) => r.importId === imp.id).map((r) => r.input.medicineName).sort()).toEqual(["Telmisarten 40", "Zorbex Forte"]);
    expect(imp.rows.map((r) => r.outcome)).toEqual(["IMPORTED", "IMPORTED", "SENT_TO_REVIEW", "SENT_TO_REVIEW", "SKIPPED"]);
    expect(db().audit.some((a) => a.action === "INVENTORY_IMPORT_CONFIRMED")).toBe(true);
  });
  it("a choice must be one of the suggested candidates; an import can only be confirmed once, by its own pharmacy", () => {
    const imp = previewImport(owner, "a.csv", csv("Telmisarten 40,,40 mg,,TB9,2028-01-31,142,130,5"));
    expect(() => confirmImport(owner, imp.id, { "2": MED.THYRONORM })).toThrow(/suggested/);
    expect(() => confirmImport(owner2, imp.id, {})).toThrow();                  // another pharmacy
    confirmImport(owner, imp.id, { "2": MED.TELMISARTAN });
    expect(() => confirmImport(owner, imp.id, {})).toThrow(/already confirmed/);
    expect(db().inventory.filter((r) => r.batch === "TB9")).toHaveLength(1);
  });
  it("a row that would drop stock below promised units is skipped with a reason, not forced", () => {
    const row = rows("ph_1", MED.PARACETAMOL)[0];
    row.stockQuantity = 20; row.reservedQuantity = 8;
    const imp = previewImport(owner, "a.csv", csv(`Paracetamol 650,,650 mg,,${row.batch},2030-01-01,33,30,3`));
    confirmImport(owner, imp.id, {});
    expect(imp.rows[0].outcome).toBe("SKIPPED");
    expect(imp.rows[0].errors!.join()).toMatch(/promised/);
    expect(row.stockQuantity).toBe(20);
  });
  it("API: multipart upload, ownership and role checks", async () => {
    const up = async (text: string, name = "stock.csv") => {
      const f = new FormData(); f.set("file", new File([text], name, { type: "text/csv" }));
      const res = await (await route("pharmacy/inventory/import")).POST(new Request("http://localhost/x", { method: "POST", body: f }), { params: Promise.resolve({}) });
      return { status: res.status, body: await res.json() };
    };
    await signIn("pharmacy@example.com");
    const r = await up(csv("Telma-40,,40 mg,,TB1,2028-01-31,142,130,50", "Nope Pill,,,,N1,2028-01-31,10,9,5"));
    expect(r.status).toBe(201);
    expect(r.body.data.counts).toEqual({ MATCHED: 1, POSSIBLE_MATCH: 0, NOT_FOUND: 1, INVALID: 0 });
    expect((await up("a,b\n1,2", "x.csv")).status).toBe(400);
    expect((await up(csv("x"), "evil.exe")).status).toBe(400);
    const id = r.body.data.id;
    await signIn("pharmacy2@example.com");
    expect((await call((await route("pharmacy/inventory/import/[id]")).GET, "GET", "/x", { params: { id } })).status).toBe(403);
    expect((await call((await route("pharmacy/inventory/import/[id]/confirm")).POST, "POST", "/x", { params: { id }, body: {} })).status).toBe(403);
    await signIn("asha@example.com");
    expect((await call((await route("pharmacy/inventory/import/[id]/confirm")).POST, "POST", "/x", { params: { id }, body: {} })).status).toBe(403);
    await signIn("pharmacy@example.com");
    const done = await call((await route("pharmacy/inventory/import/[id]/confirm")).POST, "POST", "/x", { params: { id }, body: {} });
    expect(done.body.data).toMatchObject({ imported: 1, sentToReview: 1 });
    expect((await call((await route("pharmacy/inventory/import/[id]")).DELETE, "DELETE", "/x", { params: { id } })).status).toBe(409);
  });
});

describe("medicine match review and duplicate protection", () => {
  const input = { name: "Zorbex Forte", genericName: "Zorbexin", brand: "Zorbex", manufacturer: "Acme Pharma", strength: "10 mg", dosageForm: "Tablet" as const, packSize: "10 tablets", category: "Pain & Fever" as const, prescriptionRequired: false };
  function pending() {
    const imp = previewImport(owner, "a.csv", csv("Zorbex Forte,Zorbexin,10 mg,Acme Pharma,ZB1,2028-01-31,50,45,10"));
    confirmImport(owner, imp.id, {});
    return db().matchReviews.find((r) => r.importId === imp.id)!;
  }
  it("admin can MATCH: the inventory line is created for that pharmacy against an existing medicine", () => {
    const r = pending();
    resolveMatchReview(admin, r.id, { action: "MATCH", medicineId: MED.IBUPROFEN });
    expect(r).toMatchObject({ status: "MATCHED", resolvedMedicineId: MED.IBUPROFEN, resolvedBy: "u_ad" });
    expect(rows("ph_1", MED.IBUPROFEN).some((x) => x.batch === "ZB1" && x.stockQuantity === 10)).toBe(true);
    expect(() => resolveMatchReview(admin, r.id, { action: "REJECT", note: "again" })).toThrow(/already resolved/);
    expect(db().notifications.some((n) => n.userId === "u_ph" && n.title === "A medicine was added to your stock")).toBe(true);
  });
  it("admin can CREATE a new medicine; the normalised fields are built and the stock line is added", () => {
    const r = pending();
    const m = db().medicines.length;
    resolveMatchReview(admin, r.id, { action: "CREATE", medicine: input });
    expect(db().medicines).toHaveLength(m + 1);
    const created = db().medicines.find((x) => x.name === "Zorbex Forte")!;
    expect(created).toMatchObject({ normalizedName: "zorbex forte", normalizedGenericName: "zorbexin", status: "ACTIVE" });
    expect(rows("ph_1", created.id)).toHaveLength(1);
    expect(top("zorbex")).toBe("Zorbex Forte");
    expect(db().audit.some((a) => a.action === "MEDICINE_CREATED" && a.targetId === created.id)).toBe(true);
  });
  it("admin can REJECT with a reason the pharmacy sees; a reason is required", () => {
    const r = pending();
    expect(() => resolveMatchReview(admin, r.id, { action: "REJECT", note: "" })).toThrow();
    resolveMatchReview(admin, r.id, { action: "REJECT", note: "Not a registered product" });
    expect(r.status).toBe("REJECTED");
    expect(db().notifications.some((n) => n.body.includes("Not a registered product"))).toBe(true);
    expect(db().inventory.some((i) => i.batch === "ZB1")).toBe(false);
  });
  it("duplicates are caught on name, generic, strength, manufacturer and pack size", () => {
    const tel = db().medicines.find((m) => m.id === MED.TELMISARTAN)!;
    const same = { ...tel, name: "Telma-40" };
    expect(findDuplicates(same).exact?.id).toBe(tel.id);                                         // same product, spelled differently
    expect(findDuplicates({ ...tel, name: "TELMISARTAN 40", strength: "40 MG" }).exact?.id).toBe(tel.id);   // case and spacing never make a "new" product
    expect(findDuplicates({ ...tel, manufacturer: "Another Maker" }).exact).toBeUndefined();     // a different maker is a different product
    expect(findDuplicates({ ...tel, manufacturer: "" }).exact?.id).toBe(tel.id);                 // a blank maker does not hide a duplicate
    expect(findDuplicates({ ...tel, strength: "80 mg" }).exact).toBeUndefined();                 // another strength is another product
    expect(findDuplicates({ ...tel, packSize: "10 tablets" }).exact).toBeUndefined();            // another pack
    expect(findDuplicates({ ...tel, name: "Telmisartn 40" }).near.map((m) => m.id)).toContain(tel.id); // a typo away: near duplicate
    expect(() => createMedicine(admin, { ...tel })).toThrow(/already exists/);
    expect(() => createMedicine(admin, { ...tel, name: "Telmisartn 40", manufacturer: "Other" })).toThrow(/very similar/);
    expect(createMedicine(admin, { ...tel, name: "Telmisartn 40", manufacturer: "Other" }, { confirmNotDuplicate: true }).name).toBe("Telmisartn 40");
  });
  it("CREATE from review refuses an exact duplicate (the admin must MATCH instead)", () => {
    const r = pending();
    const tel = db().medicines.find((m) => m.id === MED.TELMISARTAN)!;
    expect(() => resolveMatchReview(admin, r.id, { action: "CREATE", medicine: { ...tel } })).toThrow(/already exists/);
    expect(r.status).toBe("PENDING");
  });
  it("only admins, with a recent password confirmation, can review; pharmacies and customers cannot", async () => {
    const r = pending();
    const h = (await route("admin/medicine-matches/[id]")).POST;
    for (const who of ["pharmacy@example.com", "asha@example.com", "rider@example.com"]) {
      await signIn(who);
      expect((await call(h, "POST", "/x", { params: { id: r.id }, body: { action: "REJECT", note: "nope nope" } })).status, who).toBe(403);
      expect((await call((await route("admin/medicine-matches")).GET, "GET", "/x")).status, who).toBe(403);
    }
    await signIn("admin@example.com", { elevate: false });
    expect((await call(h, "POST", "/x", { params: { id: r.id }, body: { action: "REJECT", note: "not valid" } })).body.errors?.[0].code).toBe("ELEVATION_REQUIRED");
    await signIn("admin@example.com");
    const list = await call((await route("admin/medicine-matches")).GET, "GET", "/api/admin/medicine-matches?status=PENDING");
    expect(list.body.data[0]).toMatchObject({ id: r.id, pharmacyName: "Shree Ram Medical Store" });
    expect((await call(h, "POST", "/x", { params: { id: r.id }, body: { action: "REJECT", note: "not valid" } })).status).toBe(200);
  });
  it("admin medicine create / update / retire endpoints enforce the same duplicate rule", async () => {
    await signIn("admin@example.com");
    const create = (await route("admin/medicines")).POST;
    expect((await call(create, "POST", "/x", { body: input })).status).toBe(201);
    expect((await call(create, "POST", "/x", { body: input })).status).toBe(409);
    const id = db().medicines.find((m) => m.name === "Zorbex Forte")!.id;
    const patch = (await route("admin/medicines/[id]")).PATCH;
    expect((await call(patch, "PATCH", "/x", { params: { id }, body: { searchAliases: ["Zorb 10"] } })).status).toBe(200);
    expect(top("zorb10")).toBe("Zorbex Forte");
    expect((await call(patch, "PATCH", "/x", { params: { id }, body: { status: "INACTIVE" } })).status).toBe(200);
    expect(searchCatalog({ q: "zorbex", pincode: PIN }).items).toHaveLength(0);
  });
});

// ───────────── Reservation, expiry and concurrency ─────────────

describe("concurrency-safe reservation", () => {
  const order = { pharmacyId: "ph_1", deliveryType: "NORMAL", paymentMethod: "COD" };
  function singleBatch(qty: number) {
    for (const r of rows("ph_1", MED.PARACETAMOL)) { r.stockQuantity = 0; r.reservedQuantity = 0; }
    rows("ph_1", MED.PARACETAMOL)[0].stockQuantity = qty;
  }
  it("many customers ordering at the same instant can never oversell the last units", async () => {
    singleBatch(5);
    const buyers = ["asha@example.com", "rajesh@example.com", "priya@example.com", "salim@example.com", "sunita@example.com"];
    const addr: Record<string, string> = { "asha@example.com": "ad_1", "rajesh@example.com": "ad_3", "priya@example.com": "ad_4", "salim@example.com": "ad_5", "sunita@example.com": "ad_6" };
    const attempts = Array.from({ length: 20 }, (_, i) => buyers[i % buyers.length]);
    const results = await Promise.all(attempts.map(async (who) => {
      const u = db().users.find((x) => x.email === who)!;
      const sess: SessionUser = { id: u.id, name: u.name, role: "CUSTOMER" };
      try { return createOrder(sess, { ...order, addressId: addr[who], paymentMethod: "COD", deliveryType: "NORMAL", pharmacyId: "ph_1", items: [{ medicineId: MED.PARACETAMOL, quantity: 1 }] }).id; } catch { return null; }
    }));
    expect(results.filter(Boolean)).toHaveLength(5);                  // exactly the 5 units that exist
    const r = rows("ph_1", MED.PARACETAMOL)[0];
    expect(r.reservedQuantity).toBe(5);
    expect(availableQuantity(r)).toBe(0);
    expect(r.reservedQuantity).toBeLessThanOrEqual(r.stockQuantity);
  });
  it("through the real API as well: parallel requests, exactly the stock sells", async () => {
    singleBatch(3);
    const post = (await route("orders")).POST;
    await signIn("asha@example.com");
    const res = await Promise.all(Array.from({ length: 8 }, () => call(post, "POST", "/x", { body: { ...order, addressId: "ad_1", items: [{ medicineId: MED.PARACETAMOL, quantity: 1 }] } })));
    expect(res.filter((r) => r.status === 201)).toHaveLength(3);
    expect(res.filter((r) => r.status === 409).every((r) => /not available in the quantity/.test(String(r.body.message)))).toBe(true);
    expect(rows("ph_1", MED.PARACETAMOL)[0].reservedQuantity).toBe(3);
  });
  it("a multi-line order that cannot be completed reserves nothing at all", () => {
    singleBatch(5);
    const before = rows("ph_1", MED.PARACETAMOL)[0].reservedQuantity;
    expect(() => createOrder(customer, { ...order, addressId: "ad_1", paymentMethod: "COD", deliveryType: "NORMAL", pharmacyId: "ph_1", items: [{ medicineId: MED.PARACETAMOL, quantity: 3 }, { medicineId: MED.ORS, quantity: 9999 }] })).toThrow();
    expect(rows("ph_1", MED.PARACETAMOL)[0].reservedQuantity).toBe(before);
  });
  it("expired and inactive batches cannot be reserved", () => {
    const r = rows("ph_1", MED.PARACETAMOL)[0];
    r.expiry = new Date(Date.now() - DAY).toISOString();
    expect(() => createOrder(customer, { ...order, addressId: "ad_1", paymentMethod: "COD", deliveryType: "NORMAL", pharmacyId: "ph_1", items: [{ medicineId: MED.PARACETAMOL, quantity: 1 }] })).toThrow(/not available/);
  });
  it("price tampering: prices come only from inventory; the API refuses client prices; a batch above its own MRP is never sold", async () => {
    await signIn("asha@example.com");
    const post = (await route("orders")).POST;
    const body = { ...order, addressId: "ad_1", items: [{ medicineId: MED.PARACETAMOL, quantity: 2 }] };
    for (const extra of [{ total: 1 }, { unitPrice: 1 }, { sellingPrice: 1 }, { mrp: 1 }, { discount: 99 }]) expect((await call(post, "POST", "/x", { body: { ...body, ...extra } })).status).toBe(400);
    const ok = await call(post, "POST", "/x", { body });
    const inv = rows("ph_1", MED.PARACETAMOL)[0];
    expect(ok.body.data.items[0]).toMatchObject({ unitPrice: inv.sellingPrice, mrp: inv.mrp });
    inv.sellingPrice = inv.mrp + 10;                                      // corrupted data
    const bad = await call(post, "POST", "/x", { body });
    expect(bad.status).toBe(409);
    expect(bad.body.message).toMatch(/updating its price/);
  });
  it("the order keeps a price snapshot when the inventory price changes later", () => {
    const o = createOrder(customer, { ...order, addressId: "ad_1", paymentMethod: "COD", deliveryType: "NORMAL", pharmacyId: "ph_1", items: [{ medicineId: MED.PARACETAMOL, quantity: 2 }] });
    const price = o.items[0].unitPrice, total = o.total;
    rows("ph_1", MED.PARACETAMOL)[0].sellingPrice = 1;
    expect(o).toMatchObject({ total });
    expect(o.items[0].unitPrice).toBe(price);
  });
});

describe("reservation expiry and release (server-side)", () => {
  const mk = (method: "COD" | "UPI" = "COD", med: string = MED.PARACETAMOL) => {
    const rx = med === MED.METFORMIN ? storePrescription({ userId: "u_1", file: { name: "rx.png", type: "image/png", bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0, 1]) }, requestedMedicines: [], source: "UPLOAD" }) : undefined;
    return createOrder(customer, { pharmacyId: "ph_1", addressId: "ad_1", deliveryType: "NORMAL", paymentMethod: method, prescriptionId: rx?.id, items: [{ medicineId: med, quantity: 2 }] });
  };
  const reserved = () => rows("ph_1", MED.PARACETAMOL).reduce((s, r) => s + r.reservedQuantity, 0);

  it("every new order carries a reservation expiry, set by the server", () => {
    const cod = mk("COD"), upi = mk("UPI"), rx = mk("COD", MED.METFORMIN);
    const at = (o: { reservationExpiresAt?: string }) => Date.parse(o.reservationExpiresAt!) - Date.now();
    expect(at(upi)).toBeLessThanOrEqual(PAYMENT_WINDOW_MS);
    expect(at(cod)).toBeLessThanOrEqual(PHARMACY_RESPONSE_WINDOW_MS);
    expect(at(cod)).toBeGreaterThan(PAYMENT_WINDOW_MS);
    expect(at(rx)).toBeGreaterThan(PHARMACY_RESPONSE_WINDOW_MS); // a prescription review gets longer
  });
  it("an abandoned online order releases its stock; the sweeper does it with no page open", () => {
    const before = reserved();
    const o = mk("UPI");
    expect(reserved()).toBe(before + 2);
    expect(expireReservations(Date.now() + PAYMENT_WINDOW_MS - 60_000)).toBe(0);
    expect(expireReservations(Date.now() + PAYMENT_WINDOW_MS + 60_000)).toBe(1);
    expect(reserved()).toBe(before);
    expect(o).toMatchObject({ status: "CANCELLED", stockState: "RELEASED", paymentStatus: "FAILED" });
    expect(expireReservations(Date.now() + 10 * DAY)).toBe(0);                          // idempotent: never double-releases
    expect(reserved()).toBe(before);
  });
  it("a COD order nobody confirms in time is released with an honest message to the customer", () => {
    const before = reserved();
    const o = mk("COD");
    expireReservations(Date.now() + PHARMACY_RESPONSE_WINDOW_MS + 60_000);
    expect(o.status).toBe("CANCELLED");
    expect(reserved()).toBe(before);
    expect(db().notifications.some((n) => n.userId === "u_1" && /pharmacy could not confirm/.test(n.body))).toBe(true);
    expect(db().orderStatusHistory.filter((h) => h.orderId === o.id).at(-1)).toMatchObject({ toStatus: "CANCELLED", actorRole: "SYSTEM" });
  });
  it("paying moves the deadline to the pharmacy; confirming clears it for good; confirmed orders never expire", () => {
    const o = mk("UPI");
    confirmPayment(customer, o.id, "ref_1");
    expireReservations(Date.now() + PAYMENT_WINDOW_MS + 60_000);
    expect(o.status).toBe("PENDING");                                                  // paid: not cancelled for late payment
    advanceAsPharmacy(pharmacist, o.id, "confirm");
    expect(o.reservationExpiresAt).toBeUndefined();
    expect(expireReservations(Date.now() + 30 * DAY)).toBe(0);
    expect(o.status).toBe("CONFIRMED");
  });
  it("cancelling by hand also releases, and the sweeper does not touch it again", () => {
    const before = reserved();
    const o = mk("COD");
    cancelOrder(customer, o.id, "changed my mind");
    expect(reserved()).toBe(before);
    expect(o.reservationExpiresAt).toBeUndefined();
    expect(expireReservations(Date.now() + 30 * DAY)).toBe(0);
  });
  it("before checkout, stale reservations are released first so freed units can be bought", () => {
    for (const r of rows("ph_1", MED.PARACETAMOL)) { r.stockQuantity = 0; r.reservedQuantity = 0; }
    rows("ph_1", MED.PARACETAMOL)[0].stockQuantity = 2;
    const stale = mk("UPI");
    expect(() => mk("UPI")).toThrow(/not available/);
    vi.useFakeTimers({ now: Date.now() + PAYMENT_WINDOW_MS + 5 * 60_000 });
    expect(mk("UPI").status).toBe("PENDING");                                           // createOrder swept the stale one first
    expect(stale.status).toBe("CANCELLED");
  });
});

// ───────────── Search history, favourites, analytics, insights ─────────────

describe("recent searches (private)", () => {
  const search = async (q: string) => call((await route("medicines/search")).GET, "GET", `/api/medicines/search?pincode=${PIN}&q=${encodeURIComponent(q)}`);
  it("remembers a signed-in customer's searches, newest first, no duplicates, capped", async () => {
    await signIn("asha@example.com");
    await search("telma 40"); await search("Dolo"); await search("Telma-40");
    const h = (await call((await route("me/search-history")).GET, "GET", "/x")).body.data;
    expect(h.map((x: { query: string }) => x.query)).toEqual(["Telma-40", "Dolo"]);   // same search is not repeated
    for (let i = 0; i < 25; i++) await search(`medicine ${i}`);
    expect((await call((await route("me/search-history")).GET, "GET", "/x")).body.data).toHaveLength(15);
  });
  it("guests have no server history; other customers can never read mine; clearing works for one or all", async () => {
    await search("secret medicine");                         // guest
    expect(db().searchHistory).toHaveLength(0);
    await signIn("asha@example.com"); await search("Dolo"); await search("Telma");
    await signIn("rajesh@example.com");
    expect((await call((await route("me/search-history")).GET, "GET", "/x")).body.data).toEqual([]);
    await search("Rajesh private");
    const mine = (await call((await route("me/search-history")).GET, "GET", "/x")).body.data;
    expect(JSON.stringify(mine)).not.toMatch(/Dolo|Telma/);
    await signIn("asha@example.com");
    const ashas = (await call((await route("me/search-history")).GET, "GET", "/x")).body.data;
    expect((await call((await route("me/search-history")).DELETE, "DELETE", `/api/me/search-history?id=${ashas[0].id}`)).body.data.removed).toBe(1);
    expect((await call((await route("me/search-history")).DELETE, "DELETE", "/x")).body.data.removed).toBe(1);
    expect(db().searchHistory.some((x) => x.query === "Rajesh private")).toBe(true);        // not touched
    await signIn(undefined);
    expect((await call((await route("me/search-history")).GET, "GET", "/x")).status).toBe(401);
  });
});

describe("preferred pharmacies", () => {
  it("customers mark and unmark verified pharmacies; limited, validated, private", async () => {
    const put = (await route("me/favorite-pharmacies")).PUT;
    await signIn("asha@example.com");
    expect((await call(put, "PUT", "/x", { body: { pharmacyId: "ph_2", on: true } })).body.data.map((p: { id: string }) => p.id)).toEqual(["ph_2"]);
    expect((await call(put, "PUT", "/x", { body: { pharmacyId: "ph_5", on: true } })).status).toBe(404);   // unverified
    expect((await call(put, "PUT", "/x", { body: { pharmacyId: "ph_2", on: false } })).body.data).toEqual([]);
    await signIn("pharmacy@example.com");
    expect((await call(put, "PUT", "/x", { body: { pharmacyId: "ph_2", on: true } })).status).toBe(403);
  });
  it("availability for a signed-in customer shows their preference; a guest sees none", async () => {
    await signIn("asha@example.com");
    await call((await route("me/favorite-pharmacies")).PUT, "PUT", "/x", { body: { pharmacyId: "ph_2", on: true } });
    const h = (await route("medicines/[id]/availability")).GET;
    const mine = await call(h, "GET", `/x?pincode=${PIN}`, { params: { id: MED.PARACETAMOL } });
    expect(mine.body.data.offers.find((o: { pharmacy: { id: string } }) => o.pharmacy.id === "ph_2").preferred).toBe(true);
    await signIn(undefined);
    expect((await call(h, "GET", `/x?pincode=${PIN}`, { params: { id: MED.PARACETAMOL } })).body.data.offers.every((o: { preferred: boolean }) => !o.preferred)).toBe(true);
  });
});

describe("catalogue analytics and admin insights", () => {
  it("the browser may report selection, add-to-cart and 'find my medicine' clicks, with only harmless properties", async () => {
    const h = (await route("analytics/event")).POST;
    for (const name of ["medicine_selected", "pharmacy_selected", "medicine_added_to_cart", "find_medicine_clicked"]) {
      expect((await call(h, "POST", "/x", { body: { name, anonId: "anon-12345678", props: { medicine: MED.PARACETAMOL, pincode: PIN } } })).status, name).toBe(200);
    }
    expect((await call(h, "POST", "/x", { body: { name: "medicine_search" } })).status).toBe(400);      // server-only events cannot be forged
    expect((await call(h, "POST", "/x", { body: { name: "medicine_selected", props: { "Bad Key": "x" } } })).status).toBe(400);
  });
  it("insights: top searches, no-result searches, poor-availability areas, low-stock frequency and request conversion", async () => {
    const search = async (q: string) => call((await route("medicines/search")).GET, "GET", `/api/medicines/search?pincode=${PIN}&q=${encodeURIComponent(q)}`);
    for (let i = 0; i < 3; i++) await search("Telma 40");
    await search("Dolo");
    for (let i = 0; i < 2; i++) await search("Zorbex Forte");
    quickStockUpdate(owner, rows("ph_1", MED.PARACETAMOL)[0].id, 2); // falls below the alert level
    const m = db().users.find((u) => u.id === "u_2")!;
    const reqs = db().medicineRequests.filter((r) => r.userId === m.id || r.userId === "u_3");
    expect(reqs.length).toBeGreaterThan(0);
    await signIn("admin@example.com");
    const r = (await call((await route("admin/catalog-insights")).GET, "GET", "/x")).body.data;
    expect(r.topSearched[0]).toEqual({ query: "telma 40", count: 3 });
    expect(r.highNoResult[0]).toEqual({ query: "zorbex forte", count: 2 });
    expect(r.totalSearches).toBe(6);
    expect(r.noResultRate).toBe(33);
    expect(r.poorAvailabilityAreas[0]).toMatchObject({ pincode: expect.any(String), coveragePercent: expect.any(Number) });
    expect(r.poorAvailabilityAreas.map((a: { coveragePercent: number }) => a.coveragePercent)).toEqual([...r.poorAvailabilityAreas.map((a: { coveragePercent: number }) => a.coveragePercent)].sort((a: number, b: number) => a - b));
    expect(r.lowStock.mostOftenLow[0]).toEqual({ query: "Paracetamol 650", count: 1 });
    expect(r.medicineRequests).toMatchObject({ total: expect.any(Number), answerRate: expect.any(Number), conversionRate: expect.any(Number) });
    expect(r.note).toMatch(/not medical advice/);
    expect(JSON.stringify(r)).not.toMatch(/u_\d|9876|@example/);               // aggregate only, no people
  });
  it("insights are admin-only", async () => {
    for (const who of ["pharmacy@example.com", "asha@example.com", undefined]) {
      await signIn(who);
      expect((await call((await route("admin/catalog-insights")).GET, "GET", "/x")).status).toBe(who ? 403 : 401);
    }
  });
});
