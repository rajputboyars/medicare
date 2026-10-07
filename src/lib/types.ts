/** Shared domain types for the V1 medicine-delivery ecosystem (mirrored by Mongoose models in src/models). */

export const ROLES = ["CUSTOMER", "PHARMACY_ADMIN", "PHARMACIST", "DELIVERY_PARTNER", "SUPER_ADMIN"] as const;
export type Role = (typeof ROLES)[number];

export type VerificationStatus = "PENDING" | "VERIFIED" | "REJECTED" | "SUSPENDED";

export interface GeoPoint {
  lat: number;
  lng: number;
}

export interface User {
  id: string;
  name: string;
  email?: string;
  mobile: string;
  passwordHash: string;
  role: Role;
  /** Pharmacy (staff) or delivery-partner profile the account belongs to */
  partnerId?: string;
  language: "en" | "hi";
  consent: { healthData: boolean; marketing: boolean; acceptedAt?: string };
  createdAt: string;
}

export interface SessionUser {
  id: string;
  name: string;
  role: Role;
  partnerId?: string;
}

export interface FamilyMember {
  id: string;
  userId: string;
  name: string;
  age: number;
  gender: "MALE" | "FEMALE" | "OTHER";
  relationship: "SELF" | "FATHER" | "MOTHER" | "SPOUSE" | "CHILD" | "GRANDPARENT" | "OTHER";
  bloodGroup?: string;
  allergies?: string;
  currentMedicines: string[];
  preferredPharmacyId?: string;
}

export interface Address {
  id: string;
  userId: string;
  label: string;
  contactName: string;
  contactMobile: string;
  pincode: string;
  state: string;
  district: string;
  town: string;
  village?: string;
  area: string;
  /** Landmarks are first-class: small-town addresses are often "near the temple". */
  landmark: string;
  houseDescription: string;
  location?: GeoPoint;
}

export type MedicineCategory =
  | "Diabetes"
  | "Blood Pressure"
  | "Thyroid"
  | "Asthma"
  | "Pain & Fever"
  | "Antibiotic"
  | "Mental Health"
  | "Stomach"
  | "Cold & Cough"
  | "Vitamins"
  | "Skin"
  | "Health Essentials";

export interface Medicine {
  id: string;
  name: string;
  generic: string;
  brand: string;
  strength: string;
  form: "Tablet" | "Capsule" | "Syrup" | "Injection" | "Inhaler" | "Ointment" | "Drops" | "Device" | "Sachet";
  packSize: string;
  category: MedicineCategory;
  mrp: number;
  prescriptionRequired: boolean;
  /** Restricted (e.g. Schedule H1/X): never orderable without an already-approved prescription. */
  restricted: boolean;
}

export interface Pharmacy {
  id: string;
  name: string;
  ownerName: string;
  mobile: string;
  drugLicense: string;
  gstin?: string;
  verification: VerificationStatus;
  address: string;
  pincode: string;
  district: string;
  location: GeoPoint;
  servicePincodes: string[];
  deliveryRadiusKm: number;
  openTime: string;
  closeTime: string;
  priorityDelivery: boolean;
  avgPrepMinutes: number;
  rating: number;
  ratingCount: number;
  acceptingOrders: boolean;
}

/** Availability is always pharmacy-specific: one row per pharmacy + medicine + batch. */
export interface PharmacyInventory {
  id: string;
  pharmacyId: string;
  medicineId: string;
  batch: string;
  expiry: string;
  mrp: number;
  sellingPrice: number;
  quantity: number;
  lowStockThreshold: number;
}

export type PrescriptionStatus = "RECEIVED" | "UNDER_REVIEW" | "APPROVED" | "REJECTED" | "NEEDS_CLARIFICATION";

export interface Prescription {
  id: string;
  userId: string;
  familyMemberId?: string;
  /** Private storage key – never exposed; files are served via signed URLs only. */
  fileKey: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  status: PrescriptionStatus;
  requestedMedicines: string[];
  reviewedBy?: string;
  reviewNote?: string;
  pharmacyId?: string;
  source: "UPLOAD" | "QUICK_ORDER";
  callbackMobile?: string;
  createdAt: string;
}

export const ORDER_STATUSES = [
  "PENDING",
  "PRESCRIPTION_REVIEW",
  "PRESCRIPTION_APPROVED",
  "CONFIRMED",
  "PREPARING",
  "READY_FOR_PICKUP",
  "RIDER_ASSIGNED",
  "PICKED_UP",
  "OUT_FOR_DELIVERY",
  "DELIVERED",
  "CANCELLED",
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export type DeliveryType = "NORMAL" | "PRIORITY";
export type PaymentMethod = "UPI" | "COD" | "CARD" | "WALLET";
export type PaymentStatus = "PENDING" | "PAID" | "COD_DUE" | "REFUNDED" | "FAILED";

export interface OrderItem {
  id: string;
  orderId: string;
  medicineId: string;
  name: string;
  strength: string;
  quantity: number;
  mrp: number;
  unitPrice: number;
  prescriptionRequired: boolean;
}

export interface StatusEvent {
  status: OrderStatus;
  at: string;
  note?: string;
  by?: Role;
}

export interface Order {
  id: string;
  code: string;
  userId: string;
  familyMemberId?: string;
  pharmacyId: string;
  addressId: string;
  addressSnapshot: Omit<Address, "id" | "userId">;
  items: OrderItem[];
  prescriptionId?: string;
  status: OrderStatus;
  statusHistory: StatusEvent[];
  deliveryType: DeliveryType;
  subtotal: number;
  deliveryFee: number;
  discount: number;
  total: number;
  paymentMethod: PaymentMethod;
  paymentStatus: PaymentStatus;
  etaMinutes: number;
  deliveryOtp: string;
  pickupOtp: string;
  deliveryPartnerId?: string;
  stockReserved?: boolean;
  settlementId?: string;
  cancelReason?: string;
  cancelledBy?: Role;
  isRepeat?: boolean;
  createdAt: string;
}

export interface Cart {
  id: string;
  userId: string;
  pharmacyId?: string;
  prescriptionId?: string;
  items: { medicineId: string; quantity: number }[];
  updatedAt: string;
}

export interface DeliveryPartner {
  id: string;
  userId?: string;
  name: string;
  mobile: string;
  vehicle: string;
  verification: VerificationStatus;
  available: boolean;
  location?: GeoPoint;
  joinedAt: string;
}

export interface Delivery {
  id: string;
  orderId: string;
  partnerId: string;
  status: "ASSIGNED" | "PICKED_UP" | "DELIVERED" | "CANCELLED";
  payout: number;
  cashToCollect: number;
  acceptedAt: string;
  pickedUpAt?: string;
  deliveredAt?: string;
}

export interface Payment {
  id: string;
  orderId: string;
  userId: string;
  method: PaymentMethod;
  provider: "COD" | "MOCK" | "RAZORPAY";
  amount: number;
  status: PaymentStatus;
  providerRef?: string;
  createdAt: string;
}

export interface Settlement {
  id: string;
  partnerType: "PHARMACY" | "DELIVERY";
  partnerId: string;
  periodStart: string;
  periodEnd: string;
  orderCount: number;
  gross: number;
  commission: number;
  net: number;
  status: "PENDING" | "PROCESSING" | "PAID";
  createdAt: string;
}

export interface MedicineRequest {
  id: string;
  userId: string;
  medicineQuery: string;
  mobile: string;
  pincode: string;
  status: "OPEN" | "FOUND" | "CLOSED";
  createdAt: string;
}

export interface MedicineRequestResponse {
  id: string;
  requestId: string;
  pharmacyId: string;
  response: "AVAILABLE" | "ALTERNATIVE" | "OUT_OF_STOCK";
  alternative?: string;
  restockEta?: string;
  at: string;
}

export interface Review {
  id: string;
  userId: string;
  pharmacyId: string;
  orderId: string;
  rating: number;
  comment?: string;
  createdAt: string;
}

export type NotificationEvent =
  | "ORDER_PLACED"
  | "PRESCRIPTION_APPROVED"
  | "ORDER_CONFIRMED"
  | "RIDER_ASSIGNED"
  | "OUT_FOR_DELIVERY"
  | "ORDER_DELIVERED"
  | "ORDER_CANCELLED"
  | "REFILL_REMINDER"
  | "MEDICINE_FOUND";
export type NotificationChannel = "SMS" | "WHATSAPP" | "PUSH" | "EMAIL";

export interface Notification {
  id: string;
  userId: string;
  event: NotificationEvent;
  channels: NotificationChannel[];
  title: string;
  body: string;
  read: boolean;
  createdAt: string;
}

export interface SupportTicket {
  id: string;
  userId: string;
  orderId?: string;
  subject: string;
  message: string;
  status: "OPEN" | "IN_PROGRESS" | "RESOLVED";
  createdAt: string;
}

export interface ServiceArea {
  id: string;
  level: "STATE" | "DISTRICT" | "TOWN" | "PINCODE";
  name: string;
  state: string;
  district?: string;
  pincode?: string;
  active: boolean;
  launchSignups: string[];
}

/** Saved medicines: a refill-ready list (cadence, next refill date, reminder flag) per person. */
export interface SavedMedicine {
  id: string;
  userId: string;
  familyMemberId?: string;
  label: string;
  items: { medicineId: string; quantity: number }[];
  everyDays: number;
  nextRefillAt: string;
  reminderOn: boolean;
  preferredPharmacyId?: string;
  lastReminderAt?: string;
}

export interface Offer {
  id: string;
  title: string;
  description: string;
  code: string;
  percentOff: number;
  maxDiscount: number;
  minOrder: number;
  active: boolean;
}

export interface PlatformSettings {
  commissionPercent: number;
  normalDeliveryFee: number;
  priorityDeliveryFee: number;
  freeDeliveryAbove: number;
  riderPayoutNormal: number;
  riderPayoutPriority: number;
  supportPhone: string;
}

export interface AuditLog {
  id: string;
  actorId: string;
  actorRole: Role;
  action: string;
  targetType: string;
  targetId: string;
  meta?: Record<string, unknown>;
  at: string;
}
