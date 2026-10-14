/**
 * Mongoose models for the V1 medicine-delivery platform.
 *
 * Design notes
 *  - `_id` is a string (the same id the application uses), so documents round-trip 1:1 with src/lib/types.ts.
 *  - Timestamps are real `Date`s so TTL / range / sort indexes work; the persistence layer converts them to ISO strings.
 *  - Availability is pharmacy-specific: PharmacyInventory has one row per pharmacy + medicine + batch.
 *  - Sensitive fields (password hash, prescription file key, OTPs) are `select: false` for any code that queries models directly.
 *
 * Index map (what each index serves)
 *  Medicine: text(name, generic, brand, category), name, generic, brand, category    → search
 *  Pharmacy: servicePincodes, pincode, verification+acceptingOrders, 2dsphere(geo)   → "who delivers here"
 *  PharmacyInventory: unique(pharmacy, medicine, batch), (medicine, stock, pharmacy) → "who has this medicine"
 *  Order: unique code, (userId, createdAt), (pharmacyId, status, createdAt), status, createdAt → customer/pharmacy/admin lists
 *         (paymentExpiresAt) → sweep of unpaid online orders · OrderStatusHistory: (orderId, timestamp) → the order timeline
 *  Delivery: (status, createdAt) → the pool of jobs waiting for a rider · (partnerId, status) → a rider's active jobs
 *  MedicineRequest: (status, expiresAt) → expiry sweep · (pincode, status, createdAt) → what a pharmacy should answer
 *  ServiceArea: unique(level, name), (status), pincode → rollout checks at checkout
 */
import mongoose, { Schema, type Model, type SchemaDefinition } from "mongoose";
import { ORDER_STATUSES, ROLES } from "@/lib/types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyModel = Model<any>;

const S = String;
const id = { type: S };
const verification = { type: S, enum: ["PENDING", "VERIFIED", "REJECTED", "SUSPENDED"], default: "PENDING" };
const payMethod = { type: S, enum: ["UPI", "COD", "CARD", "WALLET"] };
const payStatus = { type: S, enum: ["PENDING", "AUTHORIZED", "PAID", "FAILED", "REFUNDED", "PARTIALLY_REFUNDED"] };
const point = new Schema({ lat: Number, lng: Number }, { _id: false });
const geoJson = { type: { type: S, enum: ["Point"] }, coordinates: { type: [Number] } };

function define(name: string, def: SchemaDefinition, indexes: (s: Schema) => void = () => undefined): AnyModel {
  if (mongoose.models[name]) return mongoose.models[name] as AnyModel;
  const schema = new Schema({ _id: id, ...def }, { versionKey: false, timestamps: false, strict: true });
  indexes(schema);
  return mongoose.model(name, schema) as AnyModel;
}

export const User = define("User", {
  name: { type: S, required: true, trim: true },
  email: { type: S, lowercase: true, trim: true },
  mobile: { type: S, required: true },
  passwordHash: { type: S, required: true, select: false },
  role: { type: S, enum: [...ROLES], default: "CUSTOMER" },
  partnerId: S,
  language: { type: S, enum: ["en", "hi"], default: "en" },
  consent: new Schema({ healthData: Boolean, marketing: Boolean, acceptedAt: Date }, { _id: false }),
  createdAt: { type: Date, default: Date.now },
}, (s) => {
  s.index({ mobile: 1 }, { unique: true });
  s.index({ email: 1 }, { unique: true, sparse: true });
  s.index({ role: 1, createdAt: -1 });
  s.index({ partnerId: 1 });
});

export const FamilyMember = define("FamilyMember", {
  userId: { type: S, required: true },
  name: { type: S, required: true },
  age: { type: Number, min: 0, max: 120 },
  gender: { type: S, enum: ["MALE", "FEMALE", "OTHER"] },
  relationship: { type: S, enum: ["SELF", "FATHER", "MOTHER", "SPOUSE", "CHILD", "GRANDPARENT", "OTHER"] },
  bloodGroup: S,
  allergies: S,
  currentMedicines: [S],
  preferredPharmacyId: S,
}, (s) => s.index({ userId: 1 }));

export const Address = define("Address", {
  userId: { type: S, required: true },
  label: S, contactName: S, contactMobile: S,
  pincode: { type: S, required: true }, state: S, district: S, town: S, village: S, area: S,
  landmark: { type: S, required: true }, // first-class field
  houseDescription: S,
  location: point,
}, (s) => { s.index({ userId: 1 }); s.index({ pincode: 1 }); });

export const Medicine = define("Medicine", {
  name: { type: S, required: true }, generic: S, brand: S, strength: S, form: S, packSize: S, category: S,
  mrp: { type: Number, required: true, min: 0 },
  prescriptionRequired: { type: Boolean, default: false },
  restricted: { type: Boolean, default: false },
}, (s) => {
  s.index({ name: "text", generic: "text", brand: "text", category: "text" }, { weights: { name: 10, brand: 6, generic: 5, category: 1 } });
  s.index({ name: 1 }); s.index({ generic: 1 }); s.index({ brand: 1 }); s.index({ category: 1 });
  s.index({ prescriptionRequired: 1 });
});

export const Pharmacy = define("Pharmacy", {
  name: { type: S, required: true }, ownerName: S, mobile: S,
  drugLicense: { type: S, required: true }, gstin: S,
  verification, address: S, pincode: S, district: S,
  location: point,
  geo: geoJson, // derived GeoJSON copy of `location` for $near / $geoWithin queries
  servicePincodes: [S],
  deliveryRadiusKm: Number, openTime: S, closeTime: S, priorityDelivery: Boolean, avgPrepMinutes: Number,
  rating: Number, ratingCount: Number, acceptingOrders: { type: Boolean, default: false },
}, (s) => {
  s.index({ drugLicense: 1 }, { unique: true });
  s.index({ servicePincodes: 1, verification: 1, acceptingOrders: 1 });
  s.index({ pincode: 1 }); s.index({ district: 1 }); s.index({ verification: 1 });
  s.index({ geo: "2dsphere" });
});

export const PharmacyInventory = define("PharmacyInventory", {
  pharmacyId: { type: S, required: true }, medicineId: { type: S, required: true },
  batch: { type: S, required: true }, expiry: { type: Date, required: true },
  mrp: Number, sellingPrice: Number,
  stockQuantity: { type: Number, min: 0, required: true },
  reservedQuantity: { type: Number, min: 0, default: 0 },
  lowStockThreshold: { type: Number, default: 10 },
  lastUpdatedAt: { type: Date, default: Date.now },
}, (s) => {
  s.index({ pharmacyId: 1, medicineId: 1, batch: 1 }, { unique: true });
  s.index({ medicineId: 1, stockQuantity: 1, pharmacyId: 1 }); // "which pharmacies have this medicine?"
  s.index({ pharmacyId: 1, stockQuantity: 1 });                 // low-stock alerts
  s.index({ expiry: 1 });
});

export const Prescription = define("Prescription", {
  userId: { type: S, required: true }, // string: quick-order guests use "guest:<mobile>"
  familyMemberId: S,
  fileKey: { type: S, required: true, select: false }, // private storage key – never serialised to clients
  fileName: S, mimeType: S, sizeBytes: Number,
  status: { type: S, enum: ["UPLOADED", "UNDER_REVIEW", "APPROVED", "REJECTED", "EXPIRED", "NEEDS_CLARIFICATION"], default: "UPLOADED" },
  requestedMedicines: [S], reviewedBy: S, reviewedAt: Date, reviewNote: S, pharmacyId: S, expiresAt: Date,
  source: { type: S, enum: ["UPLOAD", "QUICK_ORDER", "REQUEST"] }, callbackMobile: S,
  createdAt: { type: Date, default: Date.now },
}, (s) => { s.index({ userId: 1, createdAt: -1 }); s.index({ status: 1 }); s.index({ pharmacyId: 1, status: 1 }); });

export const MedicineRequest = define("MedicineRequest", {
  userId: { type: S, required: true }, medicineQuery: S, strength: S, quantity: { type: Number, min: 1, default: 1 }, mobile: S, pincode: { type: S, required: true },
  photoRxId: S, prescriptionId: S, familyMemberId: S, medicineId: S, serviceAreaId: S,
  status: { type: S, enum: ["SEARCHING", "FOUND", "NOT_FOUND", "EXPIRED", "CANCELLED"], default: "SEARCHING" },
  expiresAt: { type: Date, required: true },
  createdAt: { type: Date, default: Date.now },
}, (s) => { s.index({ pincode: 1, status: 1, createdAt: -1 }); s.index({ userId: 1, createdAt: -1 }); s.index({ status: 1, expiresAt: 1 }); });

export const MedicineRequestResponse = define("MedicineRequestResponse", {
  requestId: { type: S, required: true }, pharmacyId: { type: S, required: true },
  response: { type: S, enum: ["AVAILABLE", "CAN_ARRANGE", "NOT_AVAILABLE", "ALTERNATIVE_AVAILABLE"] }, alternative: S, restockEta: S,
  price: Number, availableQty: Number, prepMinutes: Number,
  at: { type: Date, default: Date.now },
}, (s) => { s.index({ requestId: 1, pharmacyId: 1 }, { unique: true }); s.index({ pharmacyId: 1 }); });

export const Cart = define("Cart", {
  userId: { type: S, required: true }, pharmacyId: S, prescriptionId: S,
  items: [new Schema({ medicineId: S, quantity: { type: Number, min: 1 } }, { _id: false })],
  updatedAt: { type: Date, default: Date.now },
}, (s) => s.index({ userId: 1 }, { unique: true }));

export const Order = define("Order", {
  code: { type: S, required: true }, userId: { type: S, required: true }, familyMemberId: S,
  pharmacyId: { type: S, required: true }, addressId: S,
  addressSnapshot: Schema.Types.Mixed, // frozen copy of the address at order time
  prescriptionId: S,
  status: { type: S, enum: [...ORDER_STATUSES], required: true },
  deliveryType: { type: S, enum: ["NORMAL", "PRIORITY"] },
  subtotal: Number, deliveryFee: Number, discount: Number, total: Number,
  paymentMethod: payMethod, paymentStatus: payStatus, etaMinutes: Number,
  stockAllocations: [new Schema({ inventoryId: S, quantity: Number }, { _id: false })],
  stockState: { type: S, enum: ["NONE", "RESERVED", "CONSUMED", "RELEASED"], default: "NONE" },
  paymentExpiresAt: Date,
  deliveryPartnerId: S, settlementId: S, cancelReason: S, cancelledBy: S, isRepeat: Boolean,
  createdAt: { type: Date, default: Date.now },
}, (s) => {
  s.index({ code: 1 }, { unique: true });
  s.index({ userId: 1, createdAt: -1 });
  s.index({ pharmacyId: 1, status: 1, createdAt: -1 });
  s.index({ status: 1, createdAt: -1 });
  s.index({ deliveryPartnerId: 1, status: 1 });
  s.index({ createdAt: -1 });
  s.index({ paymentExpiresAt: 1 }, { sparse: true });
});

/** Append-only ledger of every order transition (who moved it, from what, to what, and why). */
export const OrderStatusHistory = define("OrderStatusHistory", {
  orderId: { type: S, required: true },
  fromStatus: { type: S, enum: [...ORDER_STATUSES] },
  toStatus: { type: S, enum: [...ORDER_STATUSES], required: true },
  changedBy: { type: S, required: true },
  actorRole: { type: S, enum: [...ROLES, "SYSTEM"] },
  note: S,
  timestamp: { type: Date, default: Date.now },
}, (s) => { s.index({ orderId: 1, timestamp: 1 }); s.index({ changedBy: 1, timestamp: -1 }); });

export const OrderItem = define("OrderItem", {
  orderId: { type: S, required: true }, medicineId: { type: S, required: true }, name: S, strength: S,
  quantity: { type: Number, min: 1 }, mrp: Number, unitPrice: Number, prescriptionRequired: Boolean,
  position: Number, // keeps the original line order
}, (s) => { s.index({ orderId: 1, position: 1 }); s.index({ medicineId: 1 }); });

export const DeliveryPartner = define("DeliveryPartner", {
  userId: S, name: S, mobile: S, vehicle: S, verification, available: { type: Boolean, default: false },
  location: point, geo: geoJson, joinedAt: Date,
}, (s) => { s.index({ verification: 1, available: 1 }); s.index({ geo: "2dsphere" }); s.index({ userId: 1 }); });

export const Delivery = define("Delivery", {
  orderId: { type: S, required: true }, partnerId: S,
  status: { type: S, enum: ["WAITING_FOR_RIDER", "ASSIGNED", "AT_PHARMACY", "PICKED_UP", "OUT_FOR_DELIVERY", "DELIVERED", "FAILED"], default: "WAITING_FOR_RIDER" },
  payout: Number, cashToCollect: Number,
  // One-time codes are never stored: only a keyed hash, a nonce and a failed-attempt counter (all hidden from default queries).
  pickupOtpHash: { type: S, select: false }, deliveryOtpHash: { type: S, select: false }, otpNonce: { type: S, select: false },
  pickupAttempts: { type: Number, default: 0 }, deliveryAttempts: { type: Number, default: 0 },
  failureReason: S, createdAt: Date, acceptedAt: Date, atPharmacyAt: Date, pickedUpAt: Date, outForDeliveryAt: Date, deliveredAt: Date,
}, (s) => { s.index({ orderId: 1 }); s.index({ partnerId: 1, status: 1, deliveredAt: -1 }); s.index({ status: 1, createdAt: 1 }); });

export const Payment = define("Payment", {
  orderId: { type: S, required: true }, userId: S, method: payMethod,
  provider: { type: S, enum: ["COD", "MOCK", "RAZORPAY"] }, amount: Number, refundedAmount: { type: Number, default: 0 }, status: payStatus, providerRef: S, paidAt: Date,
  createdAt: { type: Date, default: Date.now },
}, (s) => { s.index({ orderId: 1 }, { unique: true }); s.index({ userId: 1 }); s.index({ status: 1, createdAt: -1 }); });

export const Settlement = define("Settlement", {
  partnerType: { type: S, enum: ["PHARMACY", "DELIVERY"] }, partnerId: { type: S, required: true },
  periodStart: Date, periodEnd: Date, orderCount: Number, gross: Number, commission: Number, net: Number,
  status: { type: S, enum: ["PENDING", "PROCESSING", "PAID"], default: "PENDING" },
  createdAt: { type: Date, default: Date.now },
}, (s) => { s.index({ partnerId: 1, status: 1 }); s.index({ status: 1, createdAt: -1 }); });

export const ServiceArea = define("ServiceArea", {
  level: { type: S, enum: ["STATE", "DISTRICT", "TOWN", "PINCODE"] }, name: S, state: S, district: S, town: S, pincode: S,
  status: { type: S, enum: ["ACTIVE", "COMING_SOON", "DISABLED"], default: "COMING_SOON" }, launchSignups: [S],
}, (s) => { s.index({ level: 1, name: 1 }, { unique: true }); s.index({ pincode: 1 }); s.index({ status: 1 }); });

export const Notification = define("Notification", {
  userId: { type: S, required: true }, event: S, channels: [{ type: S, enum: ["SMS", "WHATSAPP", "PUSH", "EMAIL"] }],
  title: S, body: S, read: { type: Boolean, default: false }, createdAt: { type: Date, default: Date.now },
}, (s) => s.index({ userId: 1, createdAt: -1 }));

export const SupportTicket = define("SupportTicket", {
  userId: { type: S, required: true }, orderId: S, subject: S, message: S,
  status: { type: S, enum: ["OPEN", "IN_PROGRESS", "RESOLVED"], default: "OPEN" }, createdAt: { type: Date, default: Date.now },
}, (s) => { s.index({ status: 1, createdAt: -1 }); s.index({ userId: 1 }); });

// ── Supporting collections ──

/** Saved medicines: refill-ready (cadence + next refill date + reminder flag). */
export const SavedMedicine = define("SavedMedicine", {
  userId: { type: S, required: true }, familyMemberId: S, label: S,
  items: [new Schema({ medicineId: S, quantity: Number }, { _id: false })],
  everyDays: Number, nextRefillAt: Date, reminderOn: Boolean, preferredPharmacyId: S, lastReminderAt: Date,
}, (s) => { s.index({ userId: 1 }); s.index({ reminderOn: 1, nextRefillAt: 1 }); });

export const Review = define("Review", {
  userId: S, pharmacyId: { type: S, required: true }, orderId: { type: S, required: true }, rating: { type: Number, min: 1, max: 5 }, comment: S,
  createdAt: { type: Date, default: Date.now },
}, (s) => { s.index({ orderId: 1, userId: 1 }, { unique: true }); s.index({ pharmacyId: 1 }); });

export const Offer = define("Offer", { title: S, description: S, code: S, percentOff: Number, maxDiscount: Number, minOrder: Number, active: Boolean },
  (s) => s.index({ code: 1 }, { unique: true }));

export const PlatformSettingsModel = define("PlatformSettings", {
  commissionPercent: Number, normalDeliveryFee: Number, priorityDeliveryFee: Number, freeDeliveryAbove: Number,
  riderPayoutNormal: Number, riderPayoutPriority: Number, supportPhone: S,
});

export const AuditLog = define("AuditLog", {
  actorId: S, actorRole: S, action: S, targetType: S, targetId: S, meta: Schema.Types.Mixed, at: { type: Date, default: Date.now },
}, (s) => { s.index({ at: -1 }); s.index({ actorId: 1, at: -1 }); s.index({ action: 1 }); });

/** Private prescription files (V1 stores bytes in MongoDB; swap for object storage in production). */
export const StoredFile = define("StoredFile", { bytes: { type: Buffer, select: true }, mimeType: S, ownerId: S });

export const ALL_MODELS = [
  User, FamilyMember, Address, Medicine, Pharmacy, PharmacyInventory, Prescription, MedicineRequest, MedicineRequestResponse, Cart, Order, OrderItem, OrderStatusHistory,
  DeliveryPartner, Delivery, Payment, Settlement, ServiceArea, Notification, SupportTicket, SavedMedicine, Review, Offer, PlatformSettingsModel, AuditLog, StoredFile,
];
