import { handle } from "@/server/http";
import { brands, categories } from "@/server/services/finder";
import { db } from "@/server/store";

export const GET = handle(async () => ({
  categories: categories(),
  brands: brands(),
  catalog: db().medicines.map((m) => ({ id: m.id, name: m.name, strength: m.strength, mrp: m.mrp, prescriptionRequired: m.prescriptionRequired })),
}));
