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
  /** Units physically on the shelf (includes units reserved for orders that are not yet confirmed). */
  stockQuantity: number;
  /** Units promised to open orders. availableQuantity = stockQuantity - reservedQuantity. */
  reservedQuantity: number;
  lowStockThreshold: number;
  /** When this stock line was last changed: shown to customers as "Updated 2h ago". */
  lastUpdatedAt: string;
}

export const availableQuantity = (i: Pick<PharmacyInventory, "stockQuantity" | "reservedQuantity">) => Math.max(0, i.stockQuantity - i.reservedQuantity);

/** NEEDS_CLARIFICATION is an extra holding state used when the pharmacist asks for a clearer photo (the order stays open). */
export type PrescriptionStatus = "UPLOADED" | "UNDER_REVIEW" | "APPROVED" | "REJECTED" | "EXPIRED" | "NEEDS_CLARIFICATION";

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
  source: "UPLOAD" | "QUICK_ORDER" | "REQUEST";
  callbackMobile?: string;
  reviewedAt?: string;
  /** Approved prescriptions stop being usable for NEW orders after this date (default: 6 months). */
  expiresAt?: string;
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
/** COD orders stay PENDING until the rider hands over the parcel and collects the cash. */
export type PaymentStatus = "PENDING" | "AUTHORIZED" | "PAID" | "FAILED" | "REFUNDED" | "PARTIALLY_REFUNDED";

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

/** Convenience view of an OrderStatusHistory row (same data, shorter names) kept on the order for fast rendering. */
export interface StatusEvent {
  status: OrderStatus;
  at: string;
  note?: string;
  by?: Role;
}

/** Append-only ledger: one row for every order transition. Persisted as its own collection. */
export interface OrderStatusHistory {
  id: string;
  orderId: string;
  fromStatus?: OrderStatus;
  toStatus: OrderStatus;
  /** User id, or "system" for automatic changes such as expiry. */
  changedBy: string;
  actorRole: Role | "SYSTEM";
  note?: string;
  timestamp: string;
}

export type StockState = "NONE" | "RESERVED" | "CONSUMED" | "RELEASED";
export interface StockAllocation { inventoryId: string; quantity: number }

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
  deliveryPartnerId?: string;
  /** Which inventory batches hold this order's units, and whether they are reserved, consumed or given back. */
  stockAllocations: StockAllocation[];
  stockState: StockState;
  /** Unpaid online orders release their stock if payment does not arrive by this time. */
  paymentExpiresAt?: string;
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

export type RiderStatus = "OFFLINE" | "AVAILABLE" | "BUSY" | "SUSPENDED";
export type DeliveryStatus = "WAITING_FOR_RIDER" | "ASSIGNED" | "AT_PHARMACY" | "PICKED_UP" | "OUT_FOR_DELIVERY" | "DELIVERED" | "FAILED";

export interface Delivery {
  id: string;
  orderId: string;
  /** Empty while WAITING_FOR_RIDER */
  partnerId?: string;
  status: DeliveryStatus;
  payout: number;
  cashToCollect: number;
  /** One-time codes are never stored. We keep a keyed hash, a per-delivery nonce and a failed-attempt counter. */
  pickupOtpHash: string;
  deliveryOtpHash: string;
  otpNonce: string;
  pickupAttempts: number;
  deliveryAttempts: number;
  failureReason?: string;
  createdAt: string;
  acceptedAt?: string;
  atPharmacyAt?: string;
  pickedUpAt?: string;
  outForDeliveryAt?: string;
  deliveredAt?: string;
}

export interface Payment {
  id: string;
  orderId: string;
  userId: string;
  method: PaymentMethod;
  provider: "COD" | "MOCK" | "RAZORPAY";
  amount: number;
  refundedAmount: number;
  status: PaymentStatus;
  providerRef?: string;
  paidAt?: string;
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
  strength?: string;
  quantity: number;
  mobile: string;
  pincode: string;
  /** Optional private files the customer chose to share with nearby pharmacies */
  photoRxId?: string;
  prescriptionId?: string;
  /** The person the medicine is for (a family member), if chosen */
  familyMemberId?: string;
  medicineId?: string;
  serviceAreaId?: string;
  status: MedicineRequestStatus;
  expiresAt: string;
  createdAt: string;
}

export type MedicineRequestStatus = "SEARCHING" | "FOUND" | "NOT_FOUND" | "EXPIRED" | "CANCELLED";
export type RequestResponseKind = "AVAILABLE" | "CAN_ARRANGE" | "NOT_AVAILABLE" | "ALTERNATIVE_AVAILABLE";

export interface MedicineRequestResponse {
  id: string;
  requestId: string;
  pharmacyId: string;
  response: RequestResponseKind;
  /** Only ever a suggestion for the customer to consider: prescription medicines are never swapped automatically. */
  alternative?: string;
  restockEta?: string;
  /** Filled when the pharmacy has it: price per unit, units available and how long to prepare. */
  price?: number;
  availableQty?: number;
  prepMinutes?: number;
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

export type ServiceAreaStatus = "ACTIVE" | "COMING_SOON" | "DISABLED";

export interface ServiceArea {
  id: string;
  level: "STATE" | "DISTRICT" | "TOWN" | "PINCODE";
  name: string;
  state: string;
  district?: string;
  town?: string;
  pincode?: string;
  status: ServiceAreaStatus;
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
