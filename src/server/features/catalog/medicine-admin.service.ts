import { buildMedicine, deriveSearchFields, type MedicineInput } from "@/lib/medicine-fields";
import { compactText, editDistance } from "@/lib/search-normalize";
import type { Medicine, SessionUser } from "@/lib/types";
import { ApiError, badRequest, notFound } from "@/server/errors";
import { audit, db, uid } from "@/server/store";

/**
 * Admin control of the MASTER catalogue. There is exactly one record per product for the whole platform.
 * Creating one first checks for duplicates, because a second "Telma 40" would split stock and search results in two.
 */
export interface DuplicateReport { exact?: Medicine; near: Medicine[] }

/**
 * Exact duplicate: same name, strength and form, and the generic name agrees; manufacturer and pack size must also agree
 * when BOTH records state them (a blank never blocks, a different maker is a different product).
 * Near duplicate: the name is a typo away, or the generic + strength + maker are the same under another name.
 */
export function findDuplicates(input: Pick<Medicine, "name" | "genericName" | "strength" | "dosageForm" | "manufacturer" | "packSize">, ignoreId?: string): DuplicateReport {
  const n = {
    name: compactText(input.name), generic: compactText(input.genericName), strength: compactText(input.strength), form: compactText(input.dosageForm),
    maker: compactText(input.manufacturer), pack: compactText(input.packSize),
  };
  const agree = (a: string, b: string) => !a || !b || a === b;
  let exact: Medicine | undefined;
  const near: Medicine[] = [];
  for (const m of db().medicines) {
    if (m.id === ignoreId) continue;
    const c = { name: compactText(m.name), generic: compactText(m.genericName), strength: compactText(m.strength), form: compactText(m.dosageForm), maker: compactText(m.manufacturer), pack: compactText(m.packSize) };
    const sameName = c.name === n.name || m.searchAliases.some((a) => compactText(a) === n.name);
    if (sameName && c.strength === n.strength && c.form === n.form && agree(c.generic, n.generic) && agree(c.maker, n.maker) && agree(c.pack, n.pack)) { exact ??= m; continue; }
    const typo = c.strength === n.strength && editDistance(c.name, n.name, 2) <= 2 && n.name.length >= 5;
    const sameFormula = c.generic === n.generic && c.strength === n.strength && c.form === n.form && !!n.maker && c.maker === n.maker;
    if (typo || sameFormula || (sameName && c.strength === n.strength)) near.push(m);
  }
  return { exact, near };
}

const describe = (m: Medicine) => `${m.name} ${m.strength} (${m.manufacturer || "maker not stated"})`;

export function createMedicine(actor: Pick<SessionUser, "id" | "role">, input: MedicineInput, opts: { confirmNotDuplicate?: boolean } = {}): Medicine {
  if (!input.name?.trim() || !input.genericName?.trim()) throw badRequest("Name and generic name are required");
  const dup = findDuplicates(input);
  if (dup.exact) throw new ApiError(409, `This medicine already exists: ${describe(dup.exact)}. Match it instead of creating a copy.`, undefined, "DUPLICATE_MEDICINE");
  if (dup.near.length && !opts.confirmNotDuplicate) {
    throw new ApiError(409, `Something very similar exists: ${dup.near.slice(0, 3).map(describe).join("; ")}. If this really is a different product, confirm and try again.`, undefined, "POSSIBLE_DUPLICATE");
  }
  const m = buildMedicine(uid("med"), { ...input, name: input.name.trim(), genericName: input.genericName.trim() });
  db().medicines.push(m);
  audit(actor, "MEDICINE_CREATED", "Medicine", m.id, { name: m.name, strength: m.strength });
  return m;
}

export function updateMedicine(actor: Pick<SessionUser, "id" | "role">, id: string, patch: Partial<MedicineInput>): Medicine {
  const m = db().medicines.find((x) => x.id === id);
  if (!m) throw notFound("Medicine not found");
  const next = { ...m, ...patch };
  const dup = findDuplicates(next, m.id);
  if (dup.exact) throw new ApiError(409, `This would duplicate: ${describe(dup.exact)}`, undefined, "DUPLICATE_MEDICINE");
  Object.assign(m, patch, deriveSearchFields(next), { updatedAt: new Date().toISOString() }); // normalised fields are recomputed on every update
  audit(actor, "MEDICINE_UPDATED", "Medicine", m.id, { fields: Object.keys(patch) });
  return m;
}

/** Retire a medicine: it disappears from search and cannot be added to stock, but old orders keep their own snapshot. */
export function setMedicineStatus(actor: Pick<SessionUser, "id" | "role">, id: string, status: "ACTIVE" | "INACTIVE") {
  const m = db().medicines.find((x) => x.id === id);
  if (!m) throw notFound("Medicine not found");
  m.status = status;
  m.updatedAt = new Date().toISOString();
  audit(actor, status === "ACTIVE" ? "MEDICINE_ACTIVATED" : "MEDICINE_DEACTIVATED", "Medicine", id);
  return m;
}
