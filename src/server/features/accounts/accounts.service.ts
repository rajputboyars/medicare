import type { Address, FamilyMember, Language, SessionUser, User, UserPreferences } from "@/lib/types";
import { badRequest, forbidden, notFound } from "@/server/errors";
import { db, uid } from "@/server/store";

export const toSession = (u: User): SessionUser => ({ id: u.id, name: u.name, role: u.role, partnerId: u.partnerId });

/** What the app may know about a person. Never the password hash, lock-out counters or MFA details. */
export const publicUser = (u: User) => ({
  id: u.id, name: u.name, mobile: u.mobile, email: u.email, role: u.role, partnerId: u.partnerId, language: u.language,
  pincode: u.pincode, district: u.district, preferences: u.preferences, consent: u.consent, mfaEnabled: !!u.mfa?.enabled,
});

export function listFamily(userId: string) {
  return db().familyMembers.filter((f) => f.userId === userId);
}

export function saveFamily(userId: string, input: Omit<FamilyMember, "id" | "userId">, id?: string): FamilyMember {
  const d = db();
  if (id) {
    const f = d.familyMembers.find((x) => x.id === id);
    if (!f) throw notFound("Family member not found");
    if (f.userId !== userId) throw forbidden();
    Object.assign(f, input);
    return f;
  }
  if (d.familyMembers.filter((f) => f.userId === userId).length >= 12) throw badRequest("You can add up to 12 family members");
  const f: FamilyMember = { id: uid("fm"), userId, ...input };
  d.familyMembers.push(f);
  return f;
}

export function deleteFamily(userId: string, id: string) {
  const d = db();
  const f = d.familyMembers.find((x) => x.id === id);
  if (!f) throw notFound();
  if (f.userId !== userId) throw forbidden();
  if (f.relationship === "SELF") throw badRequest("You cannot remove your own profile");
  d.familyMembers = d.familyMembers.filter((x) => x.id !== id);
}

export const listAddresses = (userId: string) =>
  db().addresses.filter((a) => a.userId === userId).sort((x, y) => Number(!!y.isDefault) - Number(!!x.isDefault));

/** Addresses are collected at checkout, not at signup. The first one saved becomes the default. */
export function saveAddress(userId: string, input: Omit<Address, "id" | "userId">): Address {
  const d = db();
  const mine = d.addresses.filter((a) => a.userId === userId);
  const makeDefault = !!input.isDefault || mine.length === 0;
  if (makeDefault) for (const a of mine) a.isDefault = false;
  const a: Address = { id: uid("ad"), userId, ...input, isDefault: makeDefault };
  d.addresses.push(a);
  return a;
}

export function updateAddress(userId: string, id: string, input: Partial<Omit<Address, "id" | "userId">>): Address {
  const d = db();
  const a = d.addresses.find((x) => x.id === id);
  if (!a) throw notFound();
  if (a.userId !== userId) throw forbidden();
  const { isDefault, ...rest } = input;
  Object.assign(a, rest);
  if (isDefault) { for (const o of d.addresses) if (o.userId === userId) o.isDefault = false; a.isDefault = true; }
  return a;
}

export function deleteAddress(userId: string, id: string) {
  const d = db();
  const a = d.addresses.find((x) => x.id === id);
  if (!a) throw notFound();
  if (a.userId !== userId) throw forbidden();
  d.addresses = d.addresses.filter((x) => x.id !== id);
  // If the default was removed, the newest remaining address takes over
  const rest = d.addresses.filter((x) => x.userId === userId);
  if (a.isDefault && rest.length) rest[rest.length - 1].isDefault = true;
}

/** Privacy controls: export everything the platform holds about this user (without file contents). */
export function exportUserData(userId: string) {
  const d = db();
  const u = d.users.find((x) => x.id === userId);
  if (!u) throw notFound();
  return {
    profile: publicUser(u),
    family: listFamily(userId),
    addresses: listAddresses(userId),
    orders: d.orders.filter((o) => o.userId === userId).map(({ stockAllocations: _a, stockState: _b, ...o }) => { void _a; void _b; return o; }),
    prescriptions: d.prescriptions.filter((p) => p.userId === userId).map(({ fileKey: _k, ...p }) => { void _k; return p; }),
  };
}

export function updatePreferences(userId: string, patch: Partial<UserPreferences>) {
  const u = db().users.find((x) => x.id === userId);
  if (!u) throw notFound();
  u.preferences = { ...u.preferences, ...patch };
  return publicUser(u);
}

export function updateConsent(userId: string, patch: { healthData?: boolean; marketing?: boolean; language?: Language }) {
  const u = db().users.find((x) => x.id === userId);
  if (!u) throw notFound();
  if (patch.healthData !== undefined) u.consent.healthData = patch.healthData;
  if (patch.marketing !== undefined) u.consent.marketing = patch.marketing;
  if (patch.language) u.language = patch.language;
  return publicUser(u);
}
