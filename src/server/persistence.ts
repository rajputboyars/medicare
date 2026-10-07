import { createHash } from "node:crypto";
import * as M from "@/models";
import type { AnyModel } from "@/models";
import { connectMongo } from "./mongo";
import { buildSeed, type Db } from "./seed";
import { db, setDb } from "./store";

/**
 * MongoDB persistence (DATA_SOURCE=mongo).
 *
 *  - At server start the working set (`db()`) is loaded from MongoDB; an empty database is seeded with the demo data.
 *  - After every mutating API request, changed documents are written back (per-document diff → bulkWrite upsert/delete).
 *
 * This is a deliberate V1 trade-off: business rules stay synchronous and fully tested, while the data is genuinely stored
 * in MongoDB with the production schemas/indexes. It assumes ONE server instance. The next step for horizontal scale is to
 * replace `db()` access in src/server/services with async repositories (the services are the only code that touches it).
 */

type Row = Record<string, unknown> & { id: string };

interface Sink {
  name: string;
  model: AnyModel;
  /** Rows to persist for this collection (each must have a string `id`). */
  extract: (d: Db) => Row[];
  /** Skip diffing for ids that already exist (immutable blobs). */
  immutable?: boolean;
  /** Called with the raw docs of this collection to fill `target`. */
  hydrate: (docs: Row[], target: Db, all: Map<string, Row[]>) => void;
  /** Document-level adjustments before writing (e.g. derived GeoJSON). */
  encode?: (row: Row) => Record<string, unknown>;
}

const simple = (name: string, model: AnyModel, key: Exclude<keyof Db, "files" | "settings" | "orders">): Sink => ({
  name, model,
  extract: (d) => d[key] as unknown as Row[],
  hydrate: (docs, target) => { (target[key] as unknown as Row[]) = docs; },
});

const withGeo = (row: Row) => {
  const loc = row.location as { lat: number; lng: number } | undefined;
  return loc ? { ...row, geo: { type: "Point", coordinates: [loc.lng, loc.lat] } } : row;
};

const SINKS: Sink[] = [
  simple("users", M.User, "users"),
  simple("familyMembers", M.FamilyMember, "familyMembers"),
  simple("addresses", M.Address, "addresses"),
  simple("medicines", M.Medicine, "medicines"),
  { ...simple("pharmacies", M.Pharmacy, "pharmacies"), encode: withGeo },
  simple("inventory", M.PharmacyInventory, "inventory"),
  simple("prescriptions", M.Prescription, "prescriptions"),
  simple("medicineRequests", M.MedicineRequest, "medicineRequests"),
  simple("medicineRequestResponses", M.MedicineRequestResponse, "medicineRequestResponses"),
  simple("carts", M.Cart, "carts"),
  {
    name: "orders", model: M.Order,
    extract: (d) => d.orders.map(({ items: _items, ...o }) => { void _items; return o as unknown as Row; }),
    hydrate: (docs, target, all) => {
      const items = all.get("orderItems") ?? [];
      target.orders = docs.map((o) => ({ ...o, items: items.filter((i) => i.orderId === o.id).sort((a, b) => Number(a.position) - Number(b.position)).map(({ position: _p, ...i }) => { void _p; return i; }) })) as unknown as Db["orders"];
    },
  },
  {
    name: "orderItems", model: M.OrderItem,
    extract: (d) => d.orders.flatMap((o) => o.items.map((i, position) => ({ ...i, position }) as unknown as Row)),
    hydrate: () => undefined, // joined into orders above
  },
  { ...simple("deliveryPartners", M.DeliveryPartner, "deliveryPartners"), encode: withGeo },
  simple("deliveries", M.Delivery, "deliveries"),
  simple("payments", M.Payment, "payments"),
  simple("settlements", M.Settlement, "settlements"),
  simple("reviews", M.Review, "reviews"),
  simple("notifications", M.Notification, "notifications"),
  simple("tickets", M.SupportTicket, "tickets"),
  simple("serviceAreas", M.ServiceArea, "serviceAreas"),
  simple("savedMedicines", M.SavedMedicine, "savedMedicines"),
  simple("offers", M.Offer, "offers"),
  { name: "settings", model: M.PlatformSettingsModel, extract: (d) => d.settings as unknown as Row[], hydrate: (docs, t) => { t.settings = docs as unknown as Db["settings"]; } },
  simple("audit", M.AuditLog, "audit"),
  {
    name: "files", model: M.StoredFile, immutable: true,
    extract: (d) => [...d.files.entries()].map(([id, f]) => ({ id, bytes: Buffer.from(f.bytes), mimeType: f.mimeType, ownerId: f.ownerId })),
    hydrate: (docs, t) => { t.files = new Map(docs.map((f) => [f.id, { bytes: new Uint8Array(f.bytes as Buffer), mimeType: String(f.mimeType), ownerId: String(f.ownerId) }])); },
  },
];

const g = globalThis as unknown as { __mcPersist?: { active: boolean; snapshot: Map<string, Map<string, string>>; chain: Promise<unknown> } };
const state = (g.__mcPersist ??= { active: false, snapshot: new Map(), chain: Promise.resolve() });

export const persistenceActive = () => state.active;

const hashOf = (v: unknown) => createHash("sha1").update(JSON.stringify(v)).digest("hex");

/** Mongo returns Dates / Buffers / _id; the app uses ISO strings and `id`. */
function normalise(v: unknown): unknown {
  if (v instanceof Date) return v.toISOString();
  if (Buffer.isBuffer(v)) return v;
  if (v && typeof v === "object" && "buffer" in (v as object) && (v as { _bsontype?: string })._bsontype === "Binary") return Buffer.from((v as { buffer: Uint8Array }).buffer);
  if (Array.isArray(v)) return v.map(normalise);
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) if (val !== null && val !== undefined) out[k] = normalise(val);
    return out;
  }
  return v;
}

function fromLean(doc: Record<string, unknown>): Row {
  const { _id, __v, geo, ...rest } = doc;
  void __v; void geo;
  return { id: String(_id), ...(normalise(rest) as object) } as Row;
}

export function toMongoDoc(row: Row, sink: Sink) {
  const enc = sink.encode ? sink.encode(row) : row;
  const { id, ...rest } = enc as Row;
  return { _id: id, ...rest };
}

async function loadAll(): Promise<Db> {
  const target = { ...buildSeed() } as Db;
  const raw = new Map<string, Row[]>();
  for (const s of SINKS) {
    // `select: false` protects secrets from accidental API serialisation; the server's working set needs them back.
    const hidden: string[] = [];
    s.model.schema.eachPath((path, type) => { if ((type as { options?: { select?: boolean } }).options?.select === false) hidden.push(`+${path}`); });
    const q = s.model.find();
    if (hidden.length) q.select(hidden.join(" "));
    raw.set(s.name, (await q.lean()).map((d: Record<string, unknown>) => fromLean(d)));
  }
  for (const s of SINKS) s.hydrate(raw.get(s.name)!, target, raw);
  return target;
}

/** Records current state as "already stored" so the next flush only writes real changes. */
function markClean(d: Db) {
  state.snapshot.clear();
  for (const s of SINKS) {
    const m = new Map<string, string>();
    for (const row of s.extract(d)) m.set(row.id, s.immutable ? "-" : hashOf(row));
    state.snapshot.set(s.name, m);
  }
}

async function flushNow(): Promise<{ written: number; deleted: number }> {
  const d = db();
  let written = 0;
  let deleted = 0;
  for (const s of SINKS) {
    const prev = state.snapshot.get(s.name) ?? new Map<string, string>();
    const next = new Map<string, string>();
    const ops: Record<string, unknown>[] = [];
    for (const row of s.extract(d)) {
      const h = s.immutable ? "-" : hashOf(row);
      next.set(row.id, h);
      if (prev.get(row.id) !== h) {
        ops.push({ replaceOne: { filter: { _id: row.id }, replacement: toMongoDoc(row, s), upsert: true } });
        written++;
      }
    }
    const gone = [...prev.keys()].filter((k) => !next.has(k));
    if (gone.length) { ops.push({ deleteMany: { filter: { _id: { $in: gone } } } }); deleted += gone.length; }
    if (ops.length) await s.model.bulkWrite(ops as never, { ordered: false });
    state.snapshot.set(s.name, next);
  }
  return { written, deleted };
}

/** Serialised so overlapping requests cannot interleave writes. Never throws into the request path. */
export function flush(): Promise<unknown> {
  if (!state.active) return Promise.resolve();
  state.chain = state.chain.then(flushNow).catch((e) => { console.error("[persistence] flush failed", e); });
  return state.chain;
}

export async function ensureIndexes() {
  await Promise.all(M.ALL_MODELS.map((m) => m.syncIndexes()));
}

/** Loads (or seeds) the database and activates write-back. Called once at server start. */
export async function initMongoStore(): Promise<void> {
  if (state.active) return;
  await connectMongo();
  await ensureIndexes();
  const empty = (await M.User.estimatedDocumentCount()) === 0;
  if (empty) {
    setDb(buildSeed());
    state.snapshot.clear(); // nothing is stored yet, so every row is "dirty" and gets written
    state.active = true;
    await flushNow();
    console.info("[persistence] empty database seeded with demo data");
  } else {
    const loaded = await loadAll();
    setDb(loaded);
    markClean(loaded);
    state.active = true;
    console.info(`[persistence] loaded ${loaded.orders.length} orders, ${loaded.users.length} users from MongoDB`);
  }
}

/** Dev/test utility: wipe every collection and re-seed. */
export async function resetMongoStore(): Promise<void> {
  await connectMongo();
  await Promise.all(M.ALL_MODELS.map((m) => m.deleteMany({})));
  state.active = false;
  state.snapshot.clear();
  setDb(buildSeed());
  state.active = true;
  await flushNow();
}

export const __testing = { loadAll, markClean, flushNow, SINKS };
