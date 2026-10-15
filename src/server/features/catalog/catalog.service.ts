import { distanceKm, isOpenNow } from "@/lib/geo";
import { estimateEta } from "@/lib/eta";
import { deliveryFee } from "@/lib/pricing";
import { compactText } from "@/lib/search-normalize";
import type { GeoPoint, Medicine, SessionUser, StockConfidence } from "@/lib/types";
import { availableQuantity } from "@/lib/types";
import { Paged, type PageMeta } from "@/server/core/response";
import { badRequest, notFound } from "@/server/errors";
import { track } from "@/server/analytics";
import { db, settings, uid } from "@/server/store";
import { validBatches } from "../inventory/stock";
import { pharmaciesFor, pincodeCenter } from "../medicines/finder.service";
import { coverageFor } from "../service-areas/service-areas.service";
import { confidenceNote, stockConfidence } from "./confidence";
import { parseQuery, rankMedicines } from "./search-core";

// ───────────── What a customer sees for one pharmacy ─────────────

export type AvailabilitySort = "FASTEST" | "CHEAPEST" | "NEAREST";

export interface Delivery {
  /** null when we cannot honestly estimate (for example the pharmacy is closed, or we do not know the distance) */
  minutes: number | null;
  range: [number, number] | null;
  /** What the estimate is built from, or why there is none. Shown so the number is never a bare promise. */
  basis: ("DISTANCE" | "PHARMACY_PREP" | "RIDER_ONLINE" | "NO_RIDER_ONLINE" | "PRESCRIPTION_CHECK" | "CLOSED" | "NO_DISTANCE")[];
  note?: string;
}

export interface PharmacyAvailability {
  pharmacy: { id: string; name: string; address: string; rating: number; verified: true; openNow: boolean; opensAt?: string; closesAt: string; priorityDelivery: boolean };
  sellingPrice: number;
  mrp: number;
  discountPercent: number;
  availableQuantity: number;
  stockState: "IN_STOCK" | "LOW_STOCK";
  distanceKm: number | null;
  estimatedDelivery: Delivery;
  /** Price of one pack plus the normal delivery fee: what CHEAPEST compares */
  deliveryFee: number;
  estimatedTotal: number;
  lastStockUpdateAt: string;
  inventoryConfidence: StockConfidence;
  confirmationMayBeNeeded: boolean;
  confidenceNote: string;
  preferred: boolean;
}

export interface AvailabilityResult {
  medicine: Medicine;
  pincode: string;
  covered: boolean;
  coverageMessage?: string;
  sort: AvailabilitySort;
  offers: PharmacyAvailability[];
  generatedAt: string;
}

const MAX_BATCH_DISCOUNT = 90;

/**
 * Which verified, open-for-orders pharmacies near this pincode can sell this medicine right now, and what it costs.
 *
 *  1. only ACTIVE medicines, only pharmacies that are VERIFIED, accepting orders, and deliver to the pincode (inside their radius)
 *  2. stock = the pharmacy's valid batches: ACTIVE, not expired, available = stock − reserved > 0. Expired or reserved-out stock never counts.
 *  3. price = the batch that would ship first (earliest expiry), straight from inventory
 *  4. ETA from real factors (distance, the pharmacy's prep time, whether any rider is online, prescription check); no estimate when it cannot be honest
 *  5. sort: FASTEST (open first, then shortest ETA) · CHEAPEST (price + delivery fee) · NEAREST (distance)
 */
export function availabilityFor(medicineId: string, input: { pincode: string; sort?: AvailabilitySort; at?: GeoPoint | null; userId?: string; now?: number }): AvailabilityResult {
  const d = db();
  const now = input.now ?? Date.now();
  const medicine = d.medicines.find((m) => m.id === medicineId && m.status === "ACTIVE");
  if (!medicine) throw notFound("Medicine not found");
  const sort = input.sort ?? "FASTEST";
  const cover = coverageFor(input.pincode);
  const point = input.at ?? pincodeCenter(input.pincode);
  const riderOnline = d.deliveryPartners.some((p) => p.available && p.verification === "VERIFIED");
  const cfg = settings();
  const favourites = new Set(d.users.find((u) => u.id === input.userId)?.favoritePharmacyIds ?? []);

  const offers: PharmacyAvailability[] = [];
  for (const p of pharmaciesFor(input.pincode, point)) {
    const batches = validBatches(p.id, medicineId, now);
    if (!batches.length) continue;
    const qty = batches.reduce((s, b) => s + availableQuantity(b), 0);
    const first = batches[0];
    const last = batches.map((b) => b.lastUpdatedAt).sort().at(-1)!;
    const open = isOpenNow(p.openTime, p.closeTime, new Date(now));
    const km = point ? Math.round(distanceKm(point, p.location) * 10) / 10 : null;
    const fee = deliveryFee(first.sellingPrice, "NORMAL", cfg);
    const confidence = stockConfidence(last, now);

    let delivery: Delivery;
    if (!open) delivery = { minutes: null, range: null, basis: ["CLOSED"], note: `Closed now. Opens at ${p.openTime}.` };
    else if (km === null) delivery = { minutes: null, range: null, basis: ["NO_DISTANCE"], note: "Add your address to see a delivery time." };
    else {
      const eta = estimateEta({ distanceKm: km, prepMinutes: p.avgPrepMinutes, needsPrescriptionReview: medicine.prescriptionRequired, riderAvailable: riderOnline, deliveryType: "NORMAL" });
      delivery = {
        minutes: eta.minutes, range: eta.range, note: riderOnline ? undefined : "No delivery partner is online right now, so this may take longer.",
        basis: ["DISTANCE", "PHARMACY_PREP", riderOnline ? "RIDER_ONLINE" : "NO_RIDER_ONLINE", ...(medicine.prescriptionRequired ? (["PRESCRIPTION_CHECK"] as const) : [])],
      };
    }
    offers.push({
      pharmacy: { id: p.id, name: p.name, address: p.address, rating: p.rating, verified: true, openNow: open, opensAt: open ? undefined : p.openTime, closesAt: p.closeTime, priorityDelivery: p.priorityDelivery },
      sellingPrice: first.sellingPrice, mrp: first.mrp,
      discountPercent: first.mrp > first.sellingPrice ? Math.min(MAX_BATCH_DISCOUNT, Math.round(((first.mrp - first.sellingPrice) / first.mrp) * 100)) : 0,
      availableQuantity: qty, stockState: qty <= first.lowStockThreshold ? "LOW_STOCK" : "IN_STOCK",
      distanceKm: km, estimatedDelivery: delivery, deliveryFee: fee, estimatedTotal: first.sellingPrice + fee,
      lastStockUpdateAt: last, inventoryConfidence: confidence, confirmationMayBeNeeded: confidence === "LOW", confidenceNote: confidenceNote(confidence),
      preferred: favourites.has(p.id),
    });
  }

  // null sorts last: an unknown is never ranked above a known value
  const n = (v: number | null) => (v === null ? Number.POSITIVE_INFINITY : v);
  const byName = (a: PharmacyAvailability, b: PharmacyAvailability) => a.pharmacy.name.localeCompare(b.pharmacy.name);
  offers.sort((a, b) => {
    // A favourite breaks a TIE; it never jumps ahead of a genuinely better option
    const pref = Number(b.preferred) - Number(a.preferred);
    if (sort === "CHEAPEST") return a.estimatedTotal - b.estimatedTotal || n(a.distanceKm) - n(b.distanceKm) || pref || byName(a, b);
    if (sort === "NEAREST") return n(a.distanceKm) - n(b.distanceKm) || a.estimatedTotal - b.estimatedTotal || pref || byName(a, b);
    return Number(b.pharmacy.openNow) - Number(a.pharmacy.openNow) || n(a.estimatedDelivery.minutes) - n(b.estimatedDelivery.minutes) || n(a.distanceKm) - n(b.distanceKm) || pref || byName(a, b);
  });

  return { medicine, pincode: input.pincode, covered: cover.available, coverageMessage: cover.available ? undefined : cover.message, sort, offers, generatedAt: new Date(now).toISOString() };
}

// ───────────── Search ─────────────

export interface SearchParams {
  q?: string;
  pincode: string;
  page?: number;
  limit?: number;
  prescriptionRequired?: boolean;
  availability?: "ALL" | "AVAILABLE";
  sort?: "RELEVANCE" | "PRICE" | "ETA" | "NAME";
  category?: string;
  userId?: string;
}

export interface SearchItem {
  medicine: Pick<Medicine, "id" | "name" | "genericName" | "brand" | "manufacturer" | "strength" | "dosageForm" | "packSize" | "category" | "prescriptionRequired" | "image" | "mrp">;
  startingPrice: number | null;
  availablePharmacyCount: number;
  /** Minutes for the quickest pharmacy, or null when no honest estimate exists */
  fastestETA: number | null;
  prescriptionRequired: boolean;
  match: "EXACT" | "PREFIX" | "WORDS" | "FUZZY" | "BROWSE";
}

const brief = (m: Medicine): SearchItem["medicine"] => ({
  id: m.id, name: m.name, genericName: m.genericName, brand: m.brand, manufacturer: m.manufacturer, strength: m.strength, dosageForm: m.dosageForm,
  packSize: m.packSize, category: m.category, prescriptionRequired: m.prescriptionRequired, image: m.image, mrp: m.mrp,
});

export function searchCatalog(p: SearchParams): Paged<SearchItem> & { didYouMean?: string } {
  const page = Math.max(1, p.page ?? 1);
  const limit = Math.min(40, Math.max(1, p.limit ?? 20));
  const hasQuery = parseQuery(p.q).words.length > 0;
  const filter = (m: Medicine) => (p.prescriptionRequired === undefined || m.prescriptionRequired === p.prescriptionRequired) && (!p.category || m.category === p.category);
  const ranked = hasQuery
    ? rankMedicines(p.q, filter)
    : db().medicines.filter((m) => m.status === "ACTIVE" && filter(m)).sort((a, b) => a.name.localeCompare(b.name)).map((medicine) => ({ medicine, score: 0, quality: "BROWSE" as const }));

  // One availability pass per candidate (cheap: it only reads in-memory rows)
  const point = pincodeCenter(p.pincode);
  const rows = ranked.map((r) => {
    const a = availabilityFor(r.medicine.id, { pincode: p.pincode, sort: "FASTEST", at: point, userId: p.userId });
    const etas = a.offers.map((o) => o.estimatedDelivery.minutes).filter((x): x is number => x !== null);
    const item: SearchItem = {
      medicine: brief(r.medicine), startingPrice: a.offers.length ? Math.min(...a.offers.map((o) => o.sellingPrice)) : null,
      availablePharmacyCount: a.offers.length, fastestETA: etas.length ? Math.min(...etas) : null, prescriptionRequired: r.medicine.prescriptionRequired, match: r.quality,
    };
    return { item, score: r.score };
  }).filter((r) => p.availability !== "AVAILABLE" || r.item.availablePharmacyCount > 0);

  const n = (v: number | null) => (v === null ? Number.POSITIVE_INFINITY : v);
  if (p.sort === "PRICE") rows.sort((a, b) => n(a.item.startingPrice) - n(b.item.startingPrice) || b.score - a.score);
  else if (p.sort === "ETA") rows.sort((a, b) => n(a.item.fastestETA) - n(b.item.fastestETA) || b.score - a.score);
  else if (p.sort === "NAME") rows.sort((a, b) => a.item.medicine.name.localeCompare(b.item.medicine.name));
  else if (hasQuery) rows.sort((a, b) => b.score - a.score || b.item.availablePharmacyCount - a.item.availablePharmacyCount || a.item.medicine.name.localeCompare(b.item.medicine.name));
  else rows.sort((a, b) => b.item.availablePharmacyCount - a.item.availablePharmacyCount || a.item.medicine.name.localeCompare(b.item.medicine.name));

  const total = rows.length;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const meta: PageMeta = { page, limit, total, totalPages, hasNext: page < totalPages, sort: p.sort ?? "RELEVANCE" };
  const out = new Paged(rows.slice((page - 1) * limit, page * limit).map((r) => r.item), meta) as Paged<SearchItem> & { didYouMean?: string };

  if (hasQuery) {
    // Privacy: the query text is kept as the normalised medicine words only, with no user id, and never the customer's identity
    track(total ? "medicine_search" : "search_no_result", {}, { q: parseQuery(p.q).text.slice(0, 40), results: total, pincode: p.pincode });
    if (p.userId && page === 1) rememberSearch(p.userId, p.q!.trim().slice(0, 60));
  }
  return out;
}

// ───────────── Autocomplete ─────────────

export interface Suggestion { medicineId: string; name: string; strength: string; generic: string; brand: string }

export function suggestMedicines(q: string | undefined, limit = 8): Suggestion[] {
  const max = Math.min(10, Math.max(1, limit));
  const seen = new Set<string>();
  const out: Suggestion[] = [];
  for (const r of rankMedicines(q)) {
    const key = compactText(`${r.medicine.name}${r.medicine.strength}`);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ medicineId: r.medicine.id, name: r.medicine.name, strength: r.medicine.strength, generic: r.medicine.genericName, brand: r.medicine.brand });
    if (out.length >= max) break;
  }
  return out;
}

// ───────────── Recent searches (private to each customer) ─────────────

const HISTORY_LIMIT = 15;

function rememberSearch(userId: string, query: string) {
  const d = db();
  const key = compactText(query);
  if (!key) return;
  d.searchHistory = d.searchHistory.filter((h) => !(h.userId === userId && compactText(h.query) === key));
  d.searchHistory.unshift({ id: uid("sh"), userId, query, at: new Date().toISOString() });
  const mine = d.searchHistory.filter((h) => h.userId === userId);
  if (mine.length > HISTORY_LIMIT) { const drop = new Set(mine.slice(HISTORY_LIMIT).map((h) => h.id)); d.searchHistory = d.searchHistory.filter((h) => !drop.has(h.id)); }
}

export const recentSearches = (user: SessionUser) => db().searchHistory.filter((h) => h.userId === user.id).map((h) => ({ id: h.id, query: h.query, at: h.at }));
export function clearSearchHistory(user: SessionUser, id?: string): number {
  const d = db();
  const before = d.searchHistory.length;
  d.searchHistory = d.searchHistory.filter((h) => !(h.userId === user.id && (!id || h.id === id)));
  return before - d.searchHistory.length;
}

// ───────────── Preferred pharmacies ─────────────

export const favoritePharmacies = (user: SessionUser) => {
  const d = db();
  return (d.users.find((u) => u.id === user.id)?.favoritePharmacyIds ?? []).flatMap((id) => d.pharmacies.filter((p) => p.id === id && p.verification === "VERIFIED").map((p) => ({ id: p.id, name: p.name, address: p.address })));
};

export function setFavoritePharmacy(user: SessionUser, pharmacyId: string, on: boolean) {
  const d = db();
  const u = d.users.find((x) => x.id === user.id);
  if (!u) throw notFound();
  if (!d.pharmacies.some((p) => p.id === pharmacyId && p.verification === "VERIFIED")) throw notFound("Pharmacy not found");
  const set = new Set(u.favoritePharmacyIds ?? []);
  if (on) set.add(pharmacyId); else set.delete(pharmacyId);
  if (set.size > 10) throw badRequest("You can keep up to 10 preferred pharmacies");
  u.favoritePharmacyIds = [...set];
  return favoritePharmacies(user);
}
