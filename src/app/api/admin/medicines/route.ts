import { z } from "zod";
import { WithMessage } from "@/server/core/response";
import { handle, paginate, parseBody, requireElevated, requireUser } from "@/server/http";
import { createMedicine } from "@/server/features/catalog/medicine-admin.service";
import { db } from "@/server/store";

export const medicineInputSchema = z.object({
  name: z.string().trim().min(2).max(100),
  genericName: z.string().trim().min(2).max(100),
  brand: z.string().trim().max(60).default(""),
  manufacturer: z.string().trim().max(80).default(""),
  strength: z.string().trim().max(40).default(""),
  dosageForm: z.enum(["Tablet", "Capsule", "Syrup", "Injection", "Inhaler", "Ointment", "Drops", "Device", "Sachet"]),
  packSize: z.string().trim().max(40).default(""),
  category: z.enum(["Diabetes", "Blood Pressure", "Thyroid", "Asthma", "Pain & Fever", "Antibiotic", "Mental Health", "Stomach", "Cold & Cough", "Vitamins", "Skin", "Health Essentials"]),
  mrp: z.number().min(0).max(100000).optional(),
  prescriptionRequired: z.boolean(),
  restricted: z.boolean().optional(),
  searchAliases: z.array(z.string().trim().max(60)).max(20).optional(),
  searchKeywords: z.array(z.string().trim().max(40)).max(30).optional(),
  image: z.string().url().max(300).optional(),
  description: z.string().trim().max(500).optional(),
}).strict();

export const GET = handle(async (req: Request) => {
  await requireUser("admin:read");
  return paginate(db().medicines, req.url, {
    sortable: { name: (m) => m.normalizedName, updatedAt: (m) => m.updatedAt, category: (m) => m.category },
    filters: { status: (m) => m.status, category: (m) => m.category, prescriptionRequired: (m) => String(m.prescriptionRequired) },
    search: (m) => `${m.name} ${m.genericName} ${m.brand} ${m.manufacturer} ${m.searchAliases.join(" ")}`,
    defaultSort: "name:asc",
  });
});

/** Create a catalogue medicine. Exact duplicates are refused; near duplicates need an explicit confirmation. */
export const POST = handle(async (req: Request) => {
  const u = await requireElevated();
  const body = await parseBody(req, medicineInputSchema.extend({ confirmNotDuplicate: z.boolean().optional() }));
  const { confirmNotDuplicate, ...input } = body;
  return new WithMessage(createMedicine(u, input, { confirmNotDuplicate }), "Medicine added", 201);
});
