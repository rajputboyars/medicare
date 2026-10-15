import { z } from "zod";
import { LANGUAGE_CODES } from "@/i18n/languages";

export const mobileSchema = z
  .string()
  .trim()
  .regex(/^[6-9]\d{9}$/, "Enter a valid 10-digit mobile number");

export const pincodeSchema = z
  .string()
  .trim()
  .regex(/^[1-9]\d{5}$/, "Enter a valid 6-digit pincode");

export const loginSchema = z.object({
  identifier: z.string().trim().min(3, "Enter your mobile number or email"),
  password: z.string().min(6, "Password must be at least 6 characters").max(128),
});

const languageSchema = z.enum(LANGUAGE_CODES);

/** Step 1 of sign-in: a mobile number. Nothing else is asked yet. */
export const otpRequestSchema = z.object({ mobile: mobileSchema }).strict();
export const otpVerifySchema = z.object({ challengeId: z.string().min(3).max(80), code: z.string().trim().regex(/^\d{6}$/, "Enter the 6-digit code") }).strict();

/** Minimal profile: name, language, pincode. Medical and address details come later, when they are needed. */
export const signupSchema = z.object({
  signupToken: z.string().min(20).max(2000),
  name: z.string().trim().min(2, "Enter your name").max(80),
  language: languageSchema.default("en"),
  pincode: pincodeSchema,
  acceptTerms: z.literal(true, { error: "Please accept the Terms of Use to continue" }),
}).strict(); // a signup can never choose its own role

export const mfaVerifySchema = z.object({ mfaToken: z.string().min(20).max(2000), code: z.string().trim().regex(/^\d{6}$/, "Enter the 6-digit code") }).strict();
export const elevateSchema = z.object({ password: z.string().min(1).max(128) }).strict();
export const preferencesSchema = z.object({
  largeText: z.boolean().optional(), largeControls: z.boolean().optional(), simplified: z.boolean().optional(), highContrast: z.boolean().optional(),
  language: languageSchema.optional(),
}).strict();
export const locationQuerySchema = z.object({
  pincode: pincodeSchema.optional(),
  lat: z.coerce.number().min(-90).max(90).optional(), lng: z.coerce.number().min(-180).max(180).optional(),
}).refine((v) => v.pincode || (v.lat !== undefined && v.lng !== undefined), { message: "Enter your pincode" });
export const callbackSchema = z.object({
  mobile: mobileSchema,
  name: z.string().trim().max(80).optional().or(z.literal("")),
  area: z.string().trim().min(2, "Tell us your area or village").max(100),
  reason: z.string().trim().min(3, "Tell us how we can help").max(300),
}).strict();

export const addressSchema = z.object({
  label: z.string().trim().min(1).max(30).default("Home"),
  contactName: z.string().trim().min(2).max(80),
  contactMobile: mobileSchema,
  pincode: pincodeSchema,
  state: z.string().trim().min(2).max(60),
  district: z.string().trim().min(2).max(60),
  town: z.string().trim().min(2).max(60),
  village: z.string().trim().max(60).optional(),
  area: z.string().trim().min(2, "Enter your area / mohalla").max(80),
  landmark: z.string().trim().min(3, "Add a landmark so the rider can find you").max(120),
  houseDescription: z.string().trim().min(2).max(160),
  location: z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) }).optional(),
  deliveryNotes: z.string().trim().max(160).optional(),
  isDefault: z.boolean().optional(),
});

export const familyMemberSchema = z.object({
  name: z.string().trim().min(2).max(80),
  age: z.coerce.number().int().min(0).max(120),
  gender: z.enum(["MALE", "FEMALE", "OTHER"]),
  relationship: z.enum(["SELF", "FATHER", "MOTHER", "SPOUSE", "CHILD", "GRANDPARENT", "OTHER"]),
  bloodGroup: z.string().trim().max(5).optional(),
  allergies: z.string().trim().max(200).optional(),
  currentMedicines: z.array(z.string().trim().min(1).max(80)).max(30).default([]),
  preferredPharmacyId: z.string().optional(),
});

/**
 * Strict on purpose: the body may only carry CHOICES. A request that also tries to send a price, total, status, payment
 * status or role is refused outright instead of being silently ignored.
 */
export const createOrderSchema = z.object({
  pharmacyId: z.string().min(1),
  addressId: z.string().min(1),
  familyMemberId: z.string().optional(),
  items: z.array(z.object({ medicineId: z.string().min(1), quantity: z.number().int().min(1).max(20) }).strict()).min(1).max(40),
  prescriptionId: z.string().optional(),
  deliveryType: z.enum(["NORMAL", "PRIORITY"]).default("NORMAL"),
  paymentMethod: z.enum(["UPI", "COD", "CARD", "WALLET"]),
  offerCode: z.string().optional(),
  isRepeat: z.boolean().optional(),
}).strict();

export const quickOrderSchema = z.object({
  mobile: mobileSchema,
  pincode: pincodeSchema,
  addressText: z.string().trim().min(5, "Tell us where to deliver (area / landmark)").max(240),
});

export const prescriptionMetaSchema = z.object({
  familyMemberId: z.string().optional(),
  requestedMedicines: z.array(z.string().trim().min(1).max(80)).max(30).default([]),
  consent: z.literal("true", { error: "Please allow us to share this prescription with the pharmacist" }),
});

export const medicineRequestSchema = z.object({
  medicineQuery: z.string().trim().min(2, "Enter the medicine name").max(100),
  strength: z.string().trim().max(40).optional().or(z.literal("")),
  quantity: z.coerce.number().int().min(1, "At least 1").max(99).default(1),
  mobile: mobileSchema,
  pincode: pincodeSchema,
  prescriptionId: z.string().optional().or(z.literal("")),
  familyMemberId: z.string().optional().or(z.literal("")),
});

/** A pharmacy's reply to "Find My Medicine". When it has the medicine it must say price, quantity and prep time. */
export const requestReplySchema = z.object({
  response: z.enum(["AVAILABLE", "CAN_ARRANGE", "NOT_AVAILABLE", "ALTERNATIVE_AVAILABLE"]),
  alternative: z.string().trim().max(100).optional(),
  restockEta: z.string().trim().max(60).optional(),
  price: z.coerce.number().positive("Enter the price").max(100000).optional(),
  availableQty: z.coerce.number().int().min(1, "Enter how many you have").max(10000).optional(),
  prepMinutes: z.coerce.number().int().min(1, "Enter minutes").max(1440).optional(),
});

export const launchSignupSchema = z.object({ mobile: mobileSchema, pincode: pincodeSchema });

export const inventoryItemSchema = z.object({
  medicineId: z.string().min(1),
  batch: z.string().trim().min(1).max(40),
  expiry: z.string().refine((s) => !Number.isNaN(Date.parse(s)), "Invalid date"),
  mrp: z.coerce.number().positive().max(100000),
  sellingPrice: z.coerce.number().positive().max(100000),
  stockQuantity: z.coerce.number().int().min(0).max(100000),
  lowStockThreshold: z.coerce.number().int().min(0).max(1000).default(10),
}).refine((v) => v.sellingPrice <= v.mrp, { message: "Selling price cannot exceed MRP", path: ["sellingPrice"] });

export const prescriptionReviewSchema = z.object({
  decision: z.enum(["APPROVE", "REJECT", "CLARIFY"]),
  note: z.string().trim().max(240).optional(),
});

export const savedMedicinesSchema = z.object({
  label: z.string().trim().min(2).max(60),
  familyMemberId: z.string().optional(),
  items: z.array(z.object({ medicineId: z.string(), quantity: z.number().int().min(1).max(12) })).min(1).max(20),
  everyDays: z.number().int().min(7).max(90).default(30),
  preferredPharmacyId: z.string().optional(),
});

export const cartSchema = z.object({
  pharmacyId: z.string().optional(),
  prescriptionId: z.string().optional(),
  items: z.array(z.object({ medicineId: z.string(), quantity: z.number().int().min(1).max(20) })).max(40),
});

export const riderRegistrationSchema = z.object({
  name: z.string().trim().min(2).max(80),
  mobile: mobileSchema,
  email: z.string().trim().email("Enter a valid email"),
  password: z.string().min(8).max(128).regex(/[A-Za-z]/, "Include a letter").regex(/\d/, "Include a number"),
  vehicle: z.string().trim().min(3, "Enter your vehicle type and number").max(60),
});

export const platformSettingsSchema = z.object({
  commissionPercent: z.number().min(0).max(40),
  normalDeliveryFee: z.number().min(0).max(500),
  priorityDeliveryFee: z.number().min(0).max(500),
  freeDeliveryAbove: z.number().min(0).max(10000),
  riderPayoutNormal: z.number().min(0).max(500),
  riderPayoutPriority: z.number().min(0).max(500),
  supportPhone: z.string().trim().min(5).max(20),
}).partial();

export const supportTicketSchema = z.object({
  subject: z.string().trim().min(3).max(100),
  message: z.string().trim().min(5).max(1000),
  orderId: z.string().optional(),
});

export const deliveryOtpSchema = z.object({ otp: z.string().regex(/^\d{4}$/, "Enter the 4-digit code") });

export const serviceAreaSchema = z.object({
  level: z.enum(["STATE", "DISTRICT", "TOWN", "PINCODE"]),
  name: z.string().trim().min(2).max(80),
  state: z.string().trim().min(2).max(60),
  district: z.string().trim().max(60).optional(),
  pincode: pincodeSchema.optional(),
  town: z.string().trim().max(60).optional(),
  status: z.enum(["ACTIVE", "COMING_SOON", "DISABLED"]).default("COMING_SOON"),
});

/** Naive CSV parser (quoted fields supported) used by inventory bulk upload. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(cur); cur = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cur); cur = "";
      if (row.some((x) => x.trim())) rows.push(row);
      row = [];
    } else cur += c;
  }
  row.push(cur);
  if (row.some((x) => x.trim())) rows.push(row);
  return rows;
}

export const pharmacyRegistrationSchema = z.object({
  ownerName: z.string().trim().min(2).max(80),
  mobile: mobileSchema,
  email: z.string().trim().email("Enter a valid email"),
  password: z.string().min(8).max(128).regex(/[A-Za-z]/, "Include a letter").regex(/\d/, "Include a number"),
  name: z.string().trim().min(3, "Enter the pharmacy name").max(100),
  drugLicense: z.string().trim().min(6, "Enter your drug licence number").max(60),
  gstin: z.string().trim().toUpperCase().regex(/^[0-9A-Z]{15}$/, "GSTIN must be 15 characters").optional().or(z.literal("")),
  address: z.string().trim().min(5).max(200),
  pincode: pincodeSchema,
  district: z.string().trim().min(2).max(60),
  servicePincodes: z.array(pincodeSchema).min(1).max(30),
  openTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).default("09:00"),
  closeTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).default("21:00"),
  consent: z.literal(true, { error: "Please confirm the declaration" }),
});
