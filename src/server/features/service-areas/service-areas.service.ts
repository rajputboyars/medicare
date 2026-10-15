import type { ServiceArea, ServiceAreaStatus } from "@/lib/types";
import { db } from "@/server/store";

export interface Coverage { available: boolean; status: ServiceAreaStatus | "UNKNOWN"; areaId?: string; message?: string }

const eq = (a?: string, b?: string) => !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();
const COMING = "We're coming to your area. We can't deliver here yet.";

/**
 * Controlled rollout. The MOST SPECIFIC matching area decides (pincode → town → district → state), so an admin can switch
 * a whole district on and still keep one pincode off (DISABLED), or the other way round. Nothing matching = not live.
 */
export function coverageForLocation(loc: { pincode: string; town?: string; district?: string; state?: string }): Coverage {
  const areas = db().serviceAreas;
  // A pincode alone is enough: fall back to the district of any pharmacy that serves it.
  const district = loc.district ?? db().pharmacies.find((p) => p.servicePincodes.includes(loc.pincode))?.district;
  const hit: ServiceArea | undefined =
    areas.find((a) => a.level === "PINCODE" && a.pincode === loc.pincode) ??
    areas.find((a) => a.level === "TOWN" && eq(a.town ?? a.name, loc.town)) ??
    areas.find((a) => a.level === "DISTRICT" && eq(a.district ?? a.name, district)) ??
    areas.find((a) => a.level === "STATE" && eq(a.state ?? a.name, loc.state));
  if (!hit) return { available: false, status: "UNKNOWN", message: COMING };
  if (hit.status === "ACTIVE") return { available: true, status: "ACTIVE", areaId: hit.id };
  return { available: false, status: hit.status, areaId: hit.id, message: hit.status === "DISABLED" ? "Delivery is paused in your area for now." : COMING };
}

export const coverageFor = (pincode: string): Coverage => coverageForLocation({ pincode });

// ───────────── Finding where a customer is, and remembering who wants us to come ─────────────

import { distanceKm } from "@/lib/geo";
import type { GeoPoint, ServiceAreaInterest } from "@/lib/types";
import { badRequest } from "../../errors";
import { track } from "../../analytics";
import { uid } from "../../store";

export interface ResolvedLocation { pincode: string; district?: string; town?: string; state?: string; coverage: Coverage; detectedBy: "PINCODE" | "COORDINATES" }

/** Everything we know about a pincode: place names from service areas, pharmacies and saved addresses. */
function describePincode(pincode: string) {
  const d = db();
  const area = d.serviceAreas.find((a) => a.level === "PINCODE" && a.pincode === pincode);
  const pharmacy = d.pharmacies.find((p) => p.servicePincodes.includes(pincode) || p.pincode === pincode);
  const addr = d.addresses.find((a) => a.pincode === pincode);
  return {
    district: area?.district ?? pharmacy?.district ?? addr?.district,
    town: addr?.town ?? area?.town,
    state: area?.state ?? addr?.state,
  };
}

/** Centre of every pincode we know, from pharmacies and customer addresses (a stand-in for a geocoder). */
function knownPincodeCentres(): { pincode: string; point: GeoPoint }[] {
  const d = db();
  const sums = new Map<string, { lat: number; lng: number; n: number }>();
  const add = (pin: string, p?: GeoPoint) => {
    if (!p) return;
    const s = sums.get(pin) ?? { lat: 0, lng: 0, n: 0 };
    s.lat += p.lat; s.lng += p.lng; s.n++;
    sums.set(pin, s);
  };
  for (const a of d.addresses) add(a.pincode, a.location);
  for (const p of d.pharmacies) add(p.pincode, p.location);
  return [...sums].map(([pincode, s]) => ({ pincode, point: { lat: s.lat / s.n, lng: s.lng / s.n } }));
}

/**
 * Turns a pincode, or GPS coordinates, into a place and says whether we deliver there.
 * Coordinates are used once to pick the nearest known pincode (within 25 km) and are not stored.
 */
export function resolveLocation(input: { pincode?: string; lat?: number; lng?: number }): ResolvedLocation {
  let pincode = input.pincode;
  let detectedBy: ResolvedLocation["detectedBy"] = "PINCODE";
  if (!pincode) {
    if (input.lat === undefined || input.lng === undefined) throw badRequest("Enter your pincode");
    const here = { lat: input.lat, lng: input.lng };
    const nearest = knownPincodeCentres().map((c) => ({ ...c, km: distanceKm(here, c.point) })).sort((a, b) => a.km - b.km)[0];
    if (!nearest || nearest.km > 25) throw badRequest("We could not tell where you are. Please type your pincode.");
    pincode = nearest.pincode;
    detectedBy = "COORDINATES";
  }
  const place = describePincode(pincode);
  return { pincode, ...place, coverage: coverageForLocation({ pincode, ...place }), detectedBy };
}

/** "Tell me when you arrive". One row per mobile + pincode; asking twice is harmless. */
export function registerInterest(input: { mobile: string; pincode: string }): { saved: true } {
  const d = db();
  if (!d.serviceAreaInterests.some((i) => i.mobile === input.mobile && i.pincode === input.pincode)) {
    const place = describePincode(input.pincode);
    const row: ServiceAreaInterest = { id: uid("sai"), mobile: input.mobile, pincode: input.pincode, district: place.district, createdAt: new Date().toISOString() };
    d.serviceAreaInterests.push(row);
    // Make sure the admin sees the pincode in the rollout list, as COMING_SOON
    if (!d.serviceAreas.some((a) => a.level === "PINCODE" && a.pincode === input.pincode) && !d.serviceAreas.some((a) => a.level === "DISTRICT" && place.district && a.name === place.district)) {
      d.serviceAreas.push({ id: uid("sa"), level: "PINCODE", name: input.pincode, state: place.state ?? "Unknown", district: place.district, pincode: input.pincode, status: "COMING_SOON" });
    }
    track("location_selected", {}, { covered: false });
  }
  return { saved: true };
}

/** How many people are waiting for each area (for the admin rollout screen). */
export const interestCounts = (): Map<string, number> => {
  const m = new Map<string, number>();
  for (const i of db().serviceAreaInterests) m.set(i.pincode, (m.get(i.pincode) ?? 0) + 1);
  return m;
};
