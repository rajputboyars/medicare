import type { SessionUser } from "@/lib/types";
import { badRequest } from "@/server/errors";
import { audit, db } from "@/server/store";
import { pharmacyOf } from "./pharmacy.service";

/**
 * After approval a pharmacy gets a short checklist. Each item is either worked out from real data (so it cannot be ticked
 * without doing the thing) or confirmed by the owner (bank details, training). Selling is switched on by the owner once the
 * stock exists; the checklist guides the rest.
 */
export interface ChecklistItem { key: "verified" | "inventory" | "delivery" | "bank" | "training"; label: string; done: boolean; href: string; hint: string }

export function setupChecklist(user: SessionUser) {
  const p = pharmacyOf(user);
  const stock = db().inventory.filter((i) => i.pharmacyId === p.id && i.stockQuantity > 0).length;
  const o = p.onboarding;
  const items: ChecklistItem[] = [
    { key: "verified", label: "Verified", done: p.verification === "VERIFIED", href: "/pharmacy", hint: "Your licence and documents were checked." },
    { key: "inventory", label: "Add your medicines", done: stock > 0, href: "/pharmacy/inventory", hint: "Add stock one by one or upload a CSV." },
    { key: "delivery", label: "Delivery settings", done: !!o?.deliverySettingsDone, href: "/pharmacy/settings", hint: "Your timings, area and delivery radius." },
    { key: "bank", label: "Bank or UPI for payments", done: !!o?.settlement, href: "/pharmacy/settings", hint: "Where we send your settlements." },
    { key: "training", label: "Quick training", done: !!o?.trainingDone, href: "/pharmacy", hint: "A 2-minute tour of how orders work." },
  ];
  const done = items.filter((i) => i.done).length;
  return { items, percent: Math.round((done / items.length) * 100), complete: done === items.length, walkthroughSeen: !!o?.walkthroughSeen, acceptingOrders: p.acceptingOrders };
}

export function saveSettlement(user: SessionUser, input: { holderName: string; accountNumber?: string; ifsc?: string; upiId?: string }) {
  const p = pharmacyOf(user);
  const hasBank = !!input.accountNumber && !!input.ifsc;
  if (!hasBank && !input.upiId) throw badRequest("Add a UPI id, or an account number with the IFSC code");
  p.onboarding = { deliverySettingsDone: false, trainingDone: false, walkthroughSeen: false, ...p.onboarding, settlement: { ...input, savedAt: new Date().toISOString() } };
  audit(user, "SETTLEMENT_DETAILS_SAVED", "Pharmacy", p.id); // the number itself is never logged
  return setupChecklist(user);
}

const flag = (user: SessionUser, key: "trainingDone" | "walkthroughSeen") => {
  const p = pharmacyOf(user);
  p.onboarding = { deliverySettingsDone: false, trainingDone: false, walkthroughSeen: false, ...p.onboarding, [key]: true };
  return setupChecklist(user);
};
export const completeTraining = (user: SessionUser) => flag(user, "trainingDone");
export const markWalkthroughSeen = (user: SessionUser) => flag(user, "walkthroughSeen");
