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
