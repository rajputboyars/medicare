import { compactText } from "@/lib/search-normalize";
import { parseCsv } from "@/lib/validation";
import type { ImportRow, InventoryImport, Medicine, MedicineMatchReview, SessionUser } from "@/lib/types";
import { ApiError, badRequest, conflict, forbidden, notFound } from "@/server/errors";
import { audit, db, uid } from "@/server/store";
import { track } from "@/server/analytics";
import { rankMedicines } from "../catalog/search-core";
import { createMedicine } from "../catalog/medicine-admin.service";
import { notify } from "../notifications/notify";
import { pharmacyOf, writeInventoryRow } from "../pharmacy/pharmacy.service";

/**
 * CSV inventory import: parse → validate → normalise → match to the master catalogue → PREVIEW → confirm.
 *
 *   MATCHED         one clear catalogue medicine (same name or alias, and the same strength when given)
 *   POSSIBLE_MATCH  close but not certain (typo, different strength, several candidates): the pharmacy chooses at confirm
 *   NOT_FOUND       nothing close: NEVER creates a catalogue record. It goes to an admin to match, create or reject.
 *   INVALID         bad dates, prices or numbers: skipped, with the reasons
 *
 * Nothing is written until the pharmacy confirms the preview.
 */

export const MAX_IMPORT_ROWS = 2000;

const HEADERS: Record<string, string[]> = {
  medicineName: ["medicine_name", "medicine", "name", "product", "product_name"],
  genericName: ["generic_name", "generic", "salt"],
  strength: ["strength"],
  manufacturer: ["manufacturer", "company", "maker"],
  batch: ["batch", "batch_number", "batch_no"],
  expiry: ["expiry", "expiry_date", "exp"],
  mrp: ["mrp"],
  sellingPrice: ["selling_price", "sellingprice", "price", "rate"],
  stock: ["stock", "quantity", "qty", "stock_quantity"],
};
export const CSV_TEMPLATE = "medicine_name,generic_name,strength,manufacturer,batch,expiry,mrp,selling_price,stock\nParacetamol 650,Paracetamol,650 mg,Micro Labs,B1234,2027-06-30,33,30,100\n";

function mapHeader(row: string[]): Record<string, number> | null {
  const idx: Record<string, number> = {};
  const cleaned = row.map((h) => h.trim().toLowerCase().replace(/[\s-]+/g, "_"));
  for (const [key, names] of Object.entries(HEADERS)) {
    const i = cleaned.findIndex((h) => names.includes(h));
    if (i >= 0) idx[key] = i;
  }
  const required = ["medicineName", "batch", "expiry", "mrp", "sellingPrice", "stock"];
  return required.every((k) => k in idx) ? idx : null;
}

const num = (v: string | undefined) => (v !== undefined && v.trim() !== "" && Number.isFinite(Number(v.replace(/,/g, ""))) ? Number(v.replace(/,/g, "")) : NaN);

function validateRow(input: ImportRow["input"]): string[] {
  const errs: string[] = [];
  if (!input.medicineName) errs.push("Medicine name is missing");
  if (!input.batch) errs.push("Batch number is missing");
  else if (input.batch.length > 40) errs.push("Batch number is too long");
  if (!input.expiry || Number.isNaN(Date.parse(input.expiry))) errs.push("Expiry must be a date like 2027-06-30");
  if (input.mrp === undefined || !(input.mrp > 0)) errs.push("MRP must be more than zero");
  if (input.sellingPrice === undefined || !(input.sellingPrice > 0)) errs.push("Selling price must be more than zero");
  if (input.mrp !== undefined && input.sellingPrice !== undefined && input.sellingPrice > input.mrp) errs.push("Selling price is higher than MRP");
  if (input.stock === undefined || !Number.isInteger(input.stock) || input.stock < 0) errs.push("Stock must be a whole number, zero or more");
  else if (input.stock > 100000) errs.push("Stock is unrealistically high");
  return errs;
}

/** Decide MATCHED / POSSIBLE_MATCH / NOT_FOUND for one row. */
export function matchMedicine(input: ImportRow["input"]): Pick<ImportRow, "status" | "medicineId" | "candidates"> {
  const name = compactText(input.medicineName);
  const strength = compactText(input.strength);
  const generic = compactText(input.genericName);
  const active = db().medicines.filter((m) => m.status === "ACTIVE");

  const sameName = active.filter((m) => compactText(m.name) === name || m.searchAliases.some((a) => compactText(a) === name) || compactText(`${m.name}${m.strength}`) === name);
  const strengthOk = (m: Medicine) => !strength || compactText(m.strength) === strength || compactText(m.name).includes(strength.replace(/mg|mcg|ml|gm|g$/g, ""));
  const genericOk = (m: Medicine) => !generic || compactText(m.genericName) === generic;
  const exact = sameName.filter((m) => strengthOk(m) && genericOk(m));
  if (exact.length === 1) return { status: "MATCHED", medicineId: exact[0].id };

  const query = [input.medicineName, input.strength].filter(Boolean).join(" ");
  const ranked = rankMedicines(query).filter((r) => r.score >= 20).slice(0, 4);
  const pool = exact.length > 1 ? exact.map((m) => ({ medicine: m, score: 90 })) : [...sameName.map((m) => ({ medicine: m, score: 85 })), ...ranked];
  const seen = new Set<string>();
  const candidates = pool.filter((r) => !seen.has(r.medicine.id) && seen.add(r.medicine.id)).slice(0, 4)
    .map((r) => ({ medicineId: r.medicine.id, name: r.medicine.name, strength: r.medicine.strength, score: Math.round(r.score) }));
  return candidates.length ? { status: "POSSIBLE_MATCH", candidates } : { status: "NOT_FOUND" };
}

export function previewImport(user: SessionUser, fileName: string, csv: string): InventoryImport {
  const p = pharmacyOf(user);
  const table = parseCsv(csv).filter((r) => r.some((c) => c.trim() !== ""));
  if (!table.length) throw badRequest("The file is empty");
  const idx = mapHeader(table[0]);
  if (!idx) throw badRequest("The first row must name the columns: medicine_name, batch, expiry, mrp, selling_price, stock (generic_name, strength, manufacturer are optional)");
  const body = table.slice(1);
  if (!body.length) throw badRequest("The file has a header but no rows");
  if (body.length > MAX_IMPORT_ROWS) throw badRequest(`Please upload at most ${MAX_IMPORT_ROWS} rows at a time`);

  const seenKey = new Set<string>();
  const rows: ImportRow[] = body.map((cols, i) => {
    const get = (k: string) => (k in idx ? (cols[idx[k]] ?? "").trim() : "");
    const input: ImportRow["input"] = {
      medicineName: get("medicineName").replace(/\s+/g, " "), genericName: get("genericName") || undefined, strength: get("strength") || undefined, manufacturer: get("manufacturer") || undefined,
      batch: get("batch"), expiry: get("expiry"), mrp: num(get("mrp")), sellingPrice: num(get("sellingPrice")), stock: num(get("stock")),
    };
    for (const k of ["mrp", "sellingPrice", "stock"] as const) if (Number.isNaN(input[k])) input[k] = undefined;
    const errors = validateRow(input);
    // The same medicine + batch twice in one file would silently overwrite itself
    const key = `${compactText(input.medicineName)}|${compactText(input.strength)}|${compactText(input.batch)}`;
    if (!errors.length && seenKey.has(key)) errors.push("This medicine and batch appear twice in the file");
    seenKey.add(key);
    if (errors.length) return { line: i + 2, status: "INVALID", input, errors };
    return { line: i + 2, input, ...matchMedicine(input) };
  });

  const imp: InventoryImport = { id: uid("imp"), pharmacyId: p.id, createdBy: user.id, status: "PREVIEW", fileName: fileName.slice(0, 100), rows, createdAt: new Date().toISOString() };
  db().inventoryImports.unshift(imp);
  return imp;
}

export const importSummary = (imp: InventoryImport) => ({
  id: imp.id, status: imp.status, fileName: imp.fileName, total: imp.rows.length, imported: imp.imported, sentToReview: imp.sentToReview,
  counts: { MATCHED: imp.rows.filter((r) => r.status === "MATCHED").length, POSSIBLE_MATCH: imp.rows.filter((r) => r.status === "POSSIBLE_MATCH").length, NOT_FOUND: imp.rows.filter((r) => r.status === "NOT_FOUND").length, INVALID: imp.rows.filter((r) => r.status === "INVALID").length },
});

function ownImport(user: SessionUser, id: string): InventoryImport {
  const p = pharmacyOf(user);
  const imp = db().inventoryImports.find((x) => x.id === id);
  if (!imp) throw notFound("Import not found");
  if (imp.pharmacyId !== p.id) throw forbidden();
  return imp;
}
export const getImport = ownImport;

/**
 * Applies a previewed import. `choices` maps a line number to the medicine the pharmacy picked for a POSSIBLE_MATCH
 * (or "SKIP"). Unresolved possible matches and NOT_FOUND rows go to admin review; INVALID rows are skipped.
 */
export function confirmImport(user: SessionUser, id: string, choices: Record<string, string> = {}) {
  const p = pharmacyOf(user);
  const imp = ownImport(user, id);
  if (imp.status !== "PREVIEW") throw conflict(imp.status === "CONFIRMED" ? "This import was already confirmed." : "This import was cancelled.");
  let imported = 0, review = 0;

  for (const row of imp.rows) {
    if (row.status === "INVALID") { row.outcome = "SKIPPED"; continue; }
    let medicineId = row.status === "MATCHED" ? row.medicineId : undefined;
    if (row.status === "POSSIBLE_MATCH") {
      const choice = choices[String(row.line)];
      if (choice === "SKIP") { row.outcome = "SKIPPED"; continue; }
      if (choice) {
        if (!row.candidates?.some((c) => c.medicineId === choice)) throw badRequest(`Line ${row.line}: choose one of the suggested medicines`);
        medicineId = choice;
      }
    }
    if (!medicineId) {
      sendToReview(p.id, imp.id, row);
      row.outcome = "SENT_TO_REVIEW";
      review++;
      continue;
    }
    try {
      const i = row.input;
      writeInventoryRow(user, p, { medicineId, batch: i.batch!, expiry: new Date(i.expiry!).toISOString(), mrp: i.mrp!, sellingPrice: i.sellingPrice!, stockQuantity: i.stock!, lowStockThreshold: 10 });
      row.medicineId = medicineId;
      row.outcome = "IMPORTED";
      imported++;
    } catch (e) {
      row.outcome = "SKIPPED";
      row.errors = [...(row.errors ?? []), e instanceof ApiError ? e.message : "Could not save this row"];
    }
  }
  imp.status = "CONFIRMED";
  imp.confirmedAt = new Date().toISOString();
  imp.imported = imported;
  imp.sentToReview = review;
  audit(user, "INVENTORY_IMPORT_CONFIRMED", "InventoryImport", imp.id, { imported, review, rows: imp.rows.length });
  if (imported) track("inventory_added", { userId: user.id }, { via: "csv", count: imported });
  return importSummary(imp);
}

export function cancelImport(user: SessionUser, id: string) {
  const imp = ownImport(user, id);
  if (imp.status !== "PREVIEW") throw conflict("This import can no longer be cancelled.");
  imp.status = "CANCELLED";
  return importSummary(imp);
}

// ───────────── Medicine match review (admin) ─────────────

function sendToReview(pharmacyId: string, importId: string, row: ImportRow) {
  db().matchReviews.push({ id: uid("mr"), pharmacyId, importId, line: row.line, input: row.input, candidates: row.candidates, status: "PENDING", createdAt: new Date().toISOString() });
}

export function listMatchReviews() {
  const d = db();
  return d.matchReviews.map((r) => ({ ...r, pharmacyName: d.pharmacies.find((p) => p.id === r.pharmacyId)?.name }));
}

const notifyPharmacy = (pharmacyId: string, title: string, body: string) => {
  const owner = db().users.find((u) => u.partnerId === pharmacyId && u.role === "PHARMACY_ADMIN");
  if (owner) notify(owner.id, "APPLICATION_UPDATE", title, body);
};

export type MatchDecision =
  | { action: "MATCH"; medicineId: string }
  | { action: "CREATE"; medicine: Parameters<typeof createMedicine>[1]; confirmNotDuplicate?: boolean }
  | { action: "REJECT"; note: string };

export function resolveMatchReview(actor: SessionUser, id: string, decision: MatchDecision) {
  const d = db();
  const r = d.matchReviews.find((x) => x.id === id);
  if (!r) throw notFound("Review item not found");
  if (r.status !== "PENDING") throw conflict("This item was already resolved");
  const pharmacy = d.pharmacies.find((p) => p.id === r.pharmacyId);
  if (!pharmacy) throw notFound("Pharmacy not found");

  if (decision.action === "REJECT") {
    if (!decision.note?.trim()) throw badRequest("Say why, so the pharmacy can fix it", { note: "Say why" });
    r.status = "REJECTED"; r.note = decision.note.trim();
    notifyPharmacy(r.pharmacyId, "A medicine could not be added", `"${r.input.medicineName}" was not added to your stock: ${r.note}`);
  } else {
    let medicineId: string;
    if (decision.action === "MATCH") {
      if (!d.medicines.some((m) => m.id === decision.medicineId && m.status === "ACTIVE")) throw badRequest("Choose an existing medicine");
      medicineId = decision.medicineId;
      r.status = "MATCHED";
    } else {
      medicineId = createMedicine(actor, decision.medicine, { confirmNotDuplicate: decision.confirmNotDuplicate }).id; // refuses duplicates
      r.status = "CREATED";
    }
    const i = r.input;
    if (i.expiry && i.mrp && i.sellingPrice !== undefined && i.stock !== undefined && i.batch) {
      writeInventoryRow(actor, pharmacy, { medicineId, batch: i.batch, expiry: new Date(i.expiry).toISOString(), mrp: i.mrp, sellingPrice: i.sellingPrice, stockQuantity: i.stock, lowStockThreshold: 10 });
    }
    r.resolvedMedicineId = medicineId;
    notifyPharmacy(r.pharmacyId, "A medicine was added to your stock", `"${r.input.medicineName}" is now matched in the catalogue and in your inventory.`);
  }
  r.resolvedBy = actor.id; r.resolvedAt = new Date().toISOString();
  audit(actor, `MATCH_REVIEW_${decision.action}`, "MedicineMatchReview", r.id, { pharmacyId: r.pharmacyId, medicineId: r.resolvedMedicineId });
  return r satisfies MedicineMatchReview;
}

