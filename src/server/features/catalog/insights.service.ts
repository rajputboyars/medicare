import { availableQuantity } from "@/lib/types";
import { db } from "@/server/store";
import { expiryStateOf } from "../pharmacy/pharmacy.service";

/**
 * Aggregate view of what people look for and where we fall short. Counts only: these are signals about catalogue and
 * stock coverage, not medical advice or recommendations, and nothing is tied to a person.
 */
const DAY = 86400_000;

export function catalogInsights(days = 30) {
  const d = db();
  const since = Date.now() - days * DAY;
  const events = d.analytics.filter((e) => Date.parse(e.at) >= since);
  const top = (xs: string[], n = 10) => {
    const m = new Map<string, number>();
    for (const x of xs) if (x) m.set(x, (m.get(x) ?? 0) + 1);
    return [...m].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, n).map(([query, count]) => ({ query, count }));
  };
  const q = (e: (typeof events)[number]) => String(e.props?.q ?? "");

  const searches = events.filter((e) => e.name === "medicine_search" || e.name === "search_no_result");
  const noResult = events.filter((e) => e.name === "search_no_result");

  // Poor availability: of the active medicines, how many can a customer actually buy in each live pincode?
  const active = d.medicines.filter((m) => m.status === "ACTIVE");
  const now = Date.now();
  const areas = d.serviceAreas.filter((a) => a.level === "PINCODE" && a.status === "ACTIVE" && a.pincode).map((a) => {
    const pharmacies = d.pharmacies.filter((p) => p.verification === "VERIFIED" && p.acceptingOrders && p.servicePincodes.includes(a.pincode!));
    const ids = new Set(pharmacies.map((p) => p.id));
    const sellable = new Set(d.inventory.filter((i) => ids.has(i.pharmacyId) && (i.status ?? "ACTIVE") === "ACTIVE" && Date.parse(i.expiry) > now && availableQuantity(i) > 0).map((i) => i.medicineId));
    const areaSearches = searches.filter((e) => e.props?.pincode === a.pincode).length;
    const areaNoResult = noResult.filter((e) => e.props?.pincode === a.pincode).length;
    return {
      pincode: a.pincode!, district: a.district, pharmacies: pharmacies.length, medicinesAvailable: sellable.size, catalogueSize: active.length,
      coveragePercent: active.length ? Math.round((sellable.size / active.length) * 100) : 0, searches: areaSearches, noResultSearches: areaNoResult,
    };
  }).sort((a, b) => a.coveragePercent - b.coveragePercent);

  // Low stock: how often stock fell to the alert level (from the audit trail) plus what is low right now
  const byMedicine = (id: string) => d.medicines.find((m) => m.id === id)?.name ?? id;
  const lowEvents = d.audit.filter((a) => a.action === "STOCK_UPDATED" && a.meta?.low === true && Date.parse(a.at) >= since);
  const rowMedicine = (rowId: string) => d.inventory.find((i) => i.id === rowId)?.medicineId ?? "";
  const lowFrequency = top(lowEvents.map((a) => byMedicine(rowMedicine(a.targetId))));
  const lowNow = d.inventory.filter((i) => (i.status ?? "ACTIVE") === "ACTIVE" && expiryStateOf(i.expiry) !== "EXPIRED" && i.stockQuantity <= i.lowStockThreshold).length;

  // Request conversion: customers who asked "Find My Medicine", how many got an AVAILABLE reply, and how many then ordered from that pharmacy
  const requests = d.medicineRequests.filter((r) => Date.parse(r.createdAt) >= since);
  const found = requests.filter((r) => d.medicineRequestResponses.some((x) => x.requestId === r.id && x.response === "AVAILABLE"));
  const ordered = found.filter((r) => {
    const repliers = new Set(d.medicineRequestResponses.filter((x) => x.requestId === r.id && x.response === "AVAILABLE").map((x) => x.pharmacyId));
    return d.orders.some((o) => o.userId === r.userId && repliers.has(o.pharmacyId) && Date.parse(o.createdAt) >= Date.parse(r.createdAt));
  });

  return {
    periodDays: days,
    totalSearches: searches.length,
    topSearched: top(searches.map(q)),
    highNoResult: top(noResult.map(q)),
    noResultRate: searches.length ? Math.round((noResult.length / searches.length) * 100) : 0,
    poorAvailabilityAreas: areas.slice(0, 10),
    lowStock: { currentLowLines: lowNow, mostOftenLow: lowFrequency },
    medicineRequests: { total: requests.length, answeredAvailable: found.length, ordered: ordered.length, answerRate: requests.length ? Math.round((found.length / requests.length) * 100) : 0, conversionRate: found.length ? Math.round((ordered.length / found.length) * 100) : 0 },
    funnel: Object.fromEntries(["medicine_search", "medicine_selected", "availability_viewed", "pharmacy_selected", "medicine_added_to_cart", "find_medicine_clicked"].map((n) => [n, events.filter((e) => e.name === n).length])),
    note: "Counts of searches and stock. They describe catalogue coverage, not medical advice.",
  };
}
