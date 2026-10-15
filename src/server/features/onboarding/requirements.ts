import { z } from "zod";
import { mobileSchema, pincodeSchema } from "@/lib/validation";
import type { ApplicationType, DocumentKind } from "@/lib/types";

/**
 * What each application asks for, step by step. This file is the single description of both onboarding flows:
 * the server validates against it, and the screens render from /api/partner/application (which echoes it).
 *
 * `full` is checked when the applicant submits. `partial` (every field optional, formats still checked) is used for
 * autosave, so half-finished drafts can be saved without errors and finished later.
 */
export interface StepDef { key: string; label: string; hint: string; full: z.ZodObject<z.ZodRawShape>; kind?: "documents" | "review" }

const text = (min: number, max: number, msg?: string) => z.string().trim().min(min, msg).max(max);
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use the 24-hour format, like 09:30");
const notPast = (s: string) => !Number.isNaN(Date.parse(s)) && Date.parse(s) > Date.now();
const geo = { lat: z.number().min(-90).max(90).optional(), lng: z.number().min(-180).max(180).optional() };

const addressFields = {
  address: text(5, 200, "Enter the shop address"),
  area: text(2, 80, "Enter the area or mohalla"),
  town: text(2, 60, "Enter the town or village"),
  district: text(2, 60, "Enter the district"),
  state: text(2, 60, "Enter the state"),
  pincode: pincodeSchema,
  landmark: text(3, 120, "Add a landmark"),
  ...geo,
};

export const PHARMACY_STEPS: StepDef[] = [
  { key: "owner", label: "Owner", hint: "Who owns the pharmacy? Your mobile number is already verified.",
    full: z.object({ ownerName: text(2, 80, "Enter the owner's name"), email: z.string().trim().email("Enter a valid email").optional().or(z.literal("")) }) },
  { key: "store", label: "Store", hint: "How should customers see your pharmacy?",
    full: z.object({ storeName: text(3, 100, "Enter the pharmacy name"), storeType: z.enum(["RETAIL", "CHAIN_BRANCH", "CLINIC_PHARMACY"]), storePhone: mobileSchema.optional().or(z.literal("")) }) },
  { key: "address", label: "Address", hint: "Where is the shop?", full: z.object(addressFields) },
  { key: "license", label: "Drug licence", hint: "Your retail drug licence details.",
    full: z.object({
      drugLicenseNumber: text(6, 60, "Enter your drug licence number"),
      validTill: z.string().refine(notPast, "The licence must still be valid"),
      issuingState: text(2, 60, "Enter the issuing state"),
      gstin: z.string().trim().toUpperCase().regex(/^[0-9A-Z]{15}$/, "GSTIN must be 15 characters").optional().or(z.literal("")),
    }) },
  { key: "documents", label: "Documents", hint: "Upload clear photos or PDFs.", full: z.object({}), kind: "documents" },
  { key: "pharmacist", label: "Pharmacist", hint: "The registered pharmacist in charge.",
    full: z.object({ pharmacistName: text(2, 80, "Enter the pharmacist's name"), registrationNumber: text(4, 30, "Enter the registration number"), pharmacistMobile: mobileSchema }) },
  { key: "delivery", label: "Delivery", hint: "Where and when do you deliver?",
    full: z.object({
      servicePincodes: z.array(pincodeSchema).min(1, "Add at least one pincode").max(30),
      radiusKm: z.number().min(1).max(30), openTime: time, closeTime: time,
      priorityDelivery: z.boolean(), avgPrepMinutes: z.number().int().min(5).max(120),
    }) },
  { key: "inventory", label: "Stock", hint: "How will you add your medicines?",
    full: z.object({ plan: z.enum(["UPLOAD_LATER", "CSV_AFTER_APPROVAL", "MANUAL_AFTER_APPROVAL"]), estimatedItems: z.number().int().min(0).max(100000).optional() }) },
  { key: "review", label: "Review", hint: "Check everything and send it to us.", full: z.object({ consent: z.literal(true, { error: "Please confirm the details are correct" }) }), kind: "review" },
];

const riderAddress = { address: text(5, 200, "Enter your address"), town: text(2, 60), district: text(2, 60), state: text(2, 60), pincode: pincodeSchema, landmark: z.string().trim().max(120).optional() };

export const RIDER_STEPS: StepDef[] = [
  { key: "personal", label: "About you", hint: "Your name and an emergency contact.",
    full: z.object({
      fullName: text(2, 80, "Enter your full name"),
      dateOfBirth: z.string().refine((s) => !Number.isNaN(Date.parse(s)) && (Date.now() - Date.parse(s)) / (365.25 * 86400_000) >= 18, "You must be at least 18 years old"),
      emergencyContactName: text(2, 80, "Enter a contact name"), emergencyContactMobile: mobileSchema,
    }) },
  { key: "address", label: "Address", hint: "Where do you live?", full: z.object(riderAddress) },
  { key: "serviceArea", label: "Area", hint: "Which pincodes can you deliver in?", full: z.object({ servicePincodes: z.array(pincodeSchema).min(1, "Add at least one pincode").max(10) }) },
  { key: "vehicle", label: "Vehicle", hint: "What do you ride?",
    full: z.object({ vehicleType: z.enum(["BICYCLE", "SCOOTER", "MOTORCYCLE"]), vehicleNumber: z.string().trim().max(20).optional(), licenseNumber: z.string().trim().max(30).optional() })
      .refine((v) => v.vehicleType === "BICYCLE" || (!!v.vehicleNumber && v.vehicleNumber.length >= 4), { message: "Enter your vehicle number", path: ["vehicleNumber"] })
      .refine((v) => v.vehicleType === "BICYCLE" || (!!v.licenseNumber && v.licenseNumber.length >= 5), { message: "Enter your driving licence number", path: ["licenseNumber"] }) as unknown as z.ZodObject<z.ZodRawShape> },
  { key: "documents", label: "Documents", hint: "Upload clear photos.", full: z.object({}), kind: "documents" },
  { key: "payment", label: "Payments", hint: "Where should we send your earnings?",
    full: z.object({ method: z.enum(["UPI", "BANK"]), upiId: z.string().trim().max(60).optional(), accountHolder: z.string().trim().max(80).optional(), accountNumber: z.string().trim().max(24).optional(), ifsc: z.string().trim().toUpperCase().max(11).optional() })
      .refine((v) => v.method !== "UPI" || /^[\w.-]{2,}@[\w]{2,}$/.test(v.upiId ?? ""), { message: "Enter a valid UPI id, like name@bank", path: ["upiId"] })
      .refine((v) => v.method !== "BANK" || (!!v.accountHolder && /^\d{9,18}$/.test(v.accountNumber ?? "") && /^[A-Z]{4}0[A-Z0-9]{6}$/.test(v.ifsc ?? "")), { message: "Enter the account holder, account number and IFSC", path: ["accountNumber"] }) as unknown as z.ZodObject<z.ZodRawShape> },
  { key: "review", label: "Review", hint: "Check everything and send it to us.", full: z.object({ consent: z.literal(true, { error: "Please confirm the details are correct" }) }), kind: "review" },
];

export const STEPS: Record<ApplicationType, StepDef[]> = { PHARMACY: PHARMACY_STEPS, RIDER: RIDER_STEPS };

/** Lenient version for autosave: same fields, same formats, nothing required. Refinements are skipped (they need complete data). */
export function partialSchema(def: StepDef): z.ZodType<Record<string, unknown>> {
  const shape = (def.full as z.ZodObject<z.ZodRawShape>).shape ?? {};
  const out: Record<string, z.ZodType> = {};
  for (const [k, v] of Object.entries(shape)) out[k] = (v as z.ZodType).optional();
  return z.object(out).strict() as unknown as z.ZodType<Record<string, unknown>>;
}

// ───────────── Documents ─────────────

export interface DocRule { kind: DocumentKind; label: string; required: boolean; multiple?: boolean; hint?: string; requiredWhen?: (data: Record<string, Record<string, unknown>>) => boolean }

/** Configurable list: add a line here to ask for another document, no other code changes. */
export const DOCUMENT_RULES: Record<ApplicationType, DocRule[]> = {
  PHARMACY: [
    { kind: "DRUG_LICENSE", label: "Drug licence", required: true, hint: "A clear photo of the whole licence" },
    { kind: "SHOP_IMAGE", label: "Shop photo", required: true, hint: "The front of the shop, with the board visible" },
    { kind: "PHARMACIST_CERTIFICATE", label: "Pharmacist registration", required: true },
    { kind: "GST_CERTIFICATE", label: "GST certificate", required: false },
    { kind: "OTHER_BUSINESS", label: "Other business document", required: false, multiple: true, hint: "Anything else that helps us verify you" },
  ],
  RIDER: [
    { kind: "ID_PROOF", label: "ID proof (Aadhaar, voter ID or passport)", required: true },
    { kind: "PROFILE_PHOTO", label: "Your photo", required: true, hint: "Face clearly visible" },
    { kind: "DRIVING_LICENSE", label: "Driving licence", required: true, requiredWhen: (d) => d.vehicle?.vehicleType !== "BICYCLE" },
    { kind: "VEHICLE_RC", label: "Vehicle registration (RC)", required: true, requiredWhen: (d) => d.vehicle?.vehicleType !== "BICYCLE" },
  ],
};

export const requiredDocuments = (type: ApplicationType, data: Record<string, Record<string, unknown>>) =>
  DOCUMENT_RULES[type].filter((r) => r.required && (r.requiredWhen ? r.requiredWhen(data) : true));
