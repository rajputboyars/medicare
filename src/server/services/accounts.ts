import bcrypt from "bcryptjs";
import type { Address, FamilyMember, SessionUser, User } from "@/lib/types";
import { badRequest, conflict, forbidden, notFound } from "../errors";
import { db, uid } from "../store";

export const toSession = (u: User): SessionUser => ({ id: u.id, name: u.name, role: u.role, partnerId: u.partnerId });

export const publicUser = (u: User) => ({ id: u.id, name: u.name, mobile: u.mobile, email: u.email, role: u.role, partnerId: u.partnerId, language: u.language, consent: u.consent });

export function authenticate(identifier: string, password: string): User {
  const id = identifier.trim().toLowerCase();
  const u = db().users.find((x) => x.mobile === id || x.email?.toLowerCase() === id);
  // Constant-ish time: always run a compare so response timing doesn't reveal which accounts exist.
  const hash = u?.passwordHash ?? "$2a$08$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidinv";
  const ok = bcrypt.compareSync(password, hash);
  if (!u || !ok) throw badRequest("Mobile/email or password is not correct");
  return u;
}

export function registerUser(input: { name: string; mobile: string; email?: string; password: string }): User {
  const d = db();
  if (d.users.some((u) => u.mobile === input.mobile)) throw conflict("This mobile number is already registered. Please log in.");
  if (input.email && d.users.some((u) => u.email?.toLowerCase() === input.email!.toLowerCase())) throw conflict("This email is already registered.");
  const user: User = {
    id: uid("u"), name: input.name, mobile: input.mobile, email: input.email || undefined,
    passwordHash: bcrypt.hashSync(input.password, 10), role: "CUSTOMER", language: "en",
    consent: { healthData: true, marketing: false, acceptedAt: new Date().toISOString() }, createdAt: new Date().toISOString(),
  };
  d.users.push(user);
  d.familyMembers.push({ id: uid("fm"), userId: user.id, name: user.name, age: 30, gender: "OTHER", relationship: "SELF", currentMedicines: [] });
  return user;
}

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

export const listAddresses = (userId: string) => db().addresses.filter((a) => a.userId === userId);

export function saveAddress(userId: string, input: Omit<Address, "id" | "userId">): Address {
  const a: Address = { id: uid("ad"), userId, ...input };
  db().addresses.push(a);
  return a;
}

export function deleteAddress(userId: string, id: string) {
  const d = db();
  const a = d.addresses.find((x) => x.id === id);
  if (!a) throw notFound();
  if (a.userId !== userId) throw forbidden();
  d.addresses = d.addresses.filter((x) => x.id !== id);
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
    orders: d.orders.filter((o) => o.userId === userId).map(({ deliveryOtp: _a, pickupOtp: _b, ...o }) => { void _a; void _b; return o; }),
    prescriptions: d.prescriptions.filter((p) => p.userId === userId).map(({ fileKey: _k, ...p }) => { void _k; return p; }),
  };
}

export function updateConsent(userId: string, patch: { healthData?: boolean; marketing?: boolean; language?: "en" | "hi" }) {
  const u = db().users.find((x) => x.id === userId);
  if (!u) throw notFound();
  if (patch.healthData !== undefined) u.consent.healthData = patch.healthData;
  if (patch.marketing !== undefined) u.consent.marketing = patch.marketing;
  if (patch.language) u.language = patch.language;
  return publicUser(u);
}
