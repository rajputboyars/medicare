import { compactText, normalizeText } from "./search-normalize";
import type { Medicine } from "./types";

/** The fields a person types. Everything searchable is DERIVED from them so the two can never disagree. */
export type MedicineInput = Pick<Medicine, "name" | "genericName" | "brand" | "manufacturer" | "strength" | "dosageForm" | "packSize" | "category" | "prescriptionRequired"> &
  Partial<Pick<Medicine, "mrp" | "restricted" | "searchAliases" | "searchKeywords" | "image" | "description" | "status">>;

const uniq = (xs: string[]) => [...new Set(xs.map((x) => x.trim()).filter(Boolean))];

/**
 * Builds the normalised search fields. Called on every create and update (seed, admin create, match review),
 * so a medicine can never be saved with stale normalised text.
 */
export function deriveSearchFields(m: Pick<Medicine, "name" | "genericName" | "brand" | "strength"> & Partial<Pick<Medicine, "searchAliases" | "searchKeywords">>) {
  return {
    normalizedName: normalizeText(m.name),
    normalizedGenericName: normalizeText(m.genericName),
    searchAliases: uniq(m.searchAliases ?? []),
    searchKeywords: uniq([...(m.searchKeywords ?? []), ...normalizeText(`${m.brand} ${m.genericName}`).split(" ")]).map(normalizeText).filter(Boolean),
  };
}

/** A full Medicine record from the typed fields (id and timestamps supplied by the caller). */
export function buildMedicine(id: string, input: MedicineInput, now = new Date().toISOString(), createdAt = now): Medicine {
  return {
    id, ...input, mrp: input.mrp ?? 0, restricted: input.restricted ?? false, status: input.status ?? "ACTIVE",
    ...deriveSearchFields({ ...input, searchAliases: input.searchAliases, searchKeywords: input.searchKeywords }),
    createdAt, updatedAt: now,
  };
}

/** The identity of a product, used to catch duplicates: same name, strength, form and (when known) manufacturer and pack. */
export const medicineIdentity = (m: Pick<Medicine, "name" | "genericName" | "strength" | "dosageForm" | "manufacturer" | "packSize">) => ({
  name: compactText(m.name), generic: compactText(m.genericName), strength: compactText(m.strength), form: compactText(m.dosageForm),
  maker: compactText(m.manufacturer), pack: compactText(m.packSize),
});
