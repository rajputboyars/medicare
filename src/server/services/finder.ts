import { distanceKm, isOpenNow } from "@/lib/geo";
import { estimateEta } from "@/lib/eta";
import type { GeoPoint, Medicine, Pharmacy } from "@/lib/types";
import { db } from "../store";
import { stockFor } from "../inventory";

export interface PharmacyOffer {
  pharmacyId: string;
  pharmacyName: string;
  verified: true;
  distanceKm: number;
  etaMinutes: number;
  priorityAvailable: boolean;
  open: boolean;
  closesAt: string;
  sellingPrice: number;
  mrp: number;
  quantity: number;
  rating: number;
}

export interface MedicineResult {
  medicine: Medicine;
  available: boolean;
  offers: PharmacyOffer[];
  pharmacyCount: number;
  closest?: { name: string; km: number };
  fastest?: { name: string; minutes: number };
  lowest?: { name: string; price: number };
}

/** Centre of a pincode, derived from the verified pharmacies that serve it (V1 stand-in for a geocoder). */
export function pincodeCenter(pincode: string): GeoPoint | null {
  const ps = db().pharmacies.filter((p) => p.verification === "VERIFIED" && (p.pincode === pincode || p.servicePincodes.includes(pincode)));
  if (!ps.length) return null;
  return { lat: ps.reduce((s, p) => s + p.location.lat, 0) / ps.length, lng: ps.reduce((s, p) => s + p.location.lng, 0) / ps.length };
}

/** Pharmacies that can deliver to this pincode / point: verified, accepting orders and within their own radius. */
export function pharmaciesFor(pincode: string, at?: GeoPoint | null): (Pharmacy & { km: number })[] {
  const point = at ?? pincodeCenter(pincode);
  return db()
    .pharmacies.filter((p) => p.verification === "VERIFIED" && p.acceptingOrders && p.servicePincodes.includes(pincode))
    .map((p) => ({ ...p, km: point ? distanceKm(point, p.location) : 0 }))
    .filter((p) => !point || p.km <= p.deliveryRadiusKm)
    .sort((a, b) => a.km - b.km);
}

export function offersFor(medicineId: string, pincode: string, at?: GeoPoint | null, needsReview = false): PharmacyOffer[] {
  const d = db();
  const now = new Date();
  return pharmaciesFor(pincode, at)
    .flatMap((p) => {
      const inv = stockFor(p.id, medicineId);
      if (!inv) return [];
      const riderAvailable = d.deliveryPartners.some((x) => x.available && x.verification === "VERIFIED");
      const eta = estimateEta({ distanceKm: p.km, prepMinutes: p.avgPrepMinutes, needsPrescriptionReview: needsReview, riderAvailable, deliveryType: "NORMAL" });
      return [{
        pharmacyId: p.id, pharmacyName: p.name, verified: true as const, distanceKm: p.km, etaMinutes: eta.minutes,
        priorityAvailable: p.priorityDelivery, open: isOpenNow(p.openTime, p.closeTime, now), closesAt: p.closeTime,
        sellingPrice: inv.sellingPrice, mrp: inv.mrp, quantity: inv.quantity, rating: p.rating,
      }];
    });
}

export interface SearchParams {
  q?: string;
  category?: string;
  brand?: string;
  rx?: "yes" | "no";
  maxPrice?: number;
  availableNearby?: boolean;
  pincode: string;
  limit?: number;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

export function searchMedicines(p: SearchParams): MedicineResult[] {
  const q = norm(p.q ?? "");
  const tokens = q.split(" ").filter(Boolean);
  const center = pincodeCenter(p.pincode);
  const results: (MedicineResult & { score: number })[] = [];
  for (const m of db().medicines) {
    if (p.category && m.category !== p.category) continue;
    if (p.brand && m.brand.toLowerCase() !== p.brand.toLowerCase()) continue;
    if (p.rx === "yes" && !m.prescriptionRequired) continue;
    if (p.rx === "no" && m.prescriptionRequired) continue;
    const hay = norm(`${m.name} ${m.generic} ${m.brand} ${m.category}`);
    let score = 0;
    if (tokens.length) {
      if (!tokens.every((t) => hay.includes(t))) continue;
      score = hay.startsWith(q) ? 3 : norm(m.name).includes(q) ? 2 : 1;
    }
    const offers = offersFor(m.id, p.pincode, center).sort((a, b) => a.distanceKm - b.distanceKm);
    if (p.maxPrice && !(offers.length ? offers.some((o) => o.sellingPrice <= p.maxPrice!) : m.mrp <= p.maxPrice)) continue;
    if (p.availableNearby && !offers.length) continue;
    const closest = offers[0];
    const fastest = [...offers].sort((a, b) => a.etaMinutes - b.etaMinutes)[0];
    const lowest = [...offers].sort((a, b) => a.sellingPrice - b.sellingPrice)[0];
    results.push({
      medicine: m, available: offers.length > 0, offers, pharmacyCount: offers.length, score,
      closest: closest && { name: closest.pharmacyName, km: closest.distanceKm },
      fastest: fastest && { name: fastest.pharmacyName, minutes: fastest.etaMinutes },
      lowest: lowest && { name: lowest.pharmacyName, price: lowest.sellingPrice },
    });
  }
  results.sort((a, b) => b.score - a.score || Number(b.available) - Number(a.available) || a.medicine.name.localeCompare(b.medicine.name));
  return results.slice(0, p.limit ?? 40).map((r) => ({ medicine: r.medicine, available: r.available, offers: r.offers, pharmacyCount: r.pharmacyCount, closest: r.closest, fastest: r.fastest, lowest: r.lowest }));
}

export function nearbyPharmacies(pincode: string) {
  const center = pincodeCenter(pincode);
  const now = new Date();
  return pharmaciesFor(pincode, center).map((p) => ({
    id: p.id, name: p.name, address: p.address, distanceKm: p.km, rating: p.rating, ratingCount: p.ratingCount,
    open: isOpenNow(p.openTime, p.closeTime, now), openTime: p.openTime, closeTime: p.closeTime, priorityDelivery: p.priorityDelivery, verified: true as const,
  }));
}

export function categories() {
  return [...new Set(db().medicines.map((m) => m.category))].sort();
}
export function brands() {
  return [...new Set(db().medicines.map((m) => m.brand))].sort();
}
