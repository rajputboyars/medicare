/** Shared domain types for the V1 medicine-delivery ecosystem (mirrored by Mongoose models in src/models). */

export const ROLES = ["CUSTOMER", "PHARMACY_ADMIN", "PHARMACIST", "DELIVERY_PARTNER", "SUPER_ADMIN"] as const;
export type Role = (typeof ROLES)[number];

export type VerificationStatus = "PENDING" | "VERIFIED" | "REJECTED" | "SUSPENDED";

export interface GeoPoint {
  lat: number;
  lng: number;
}

export type Language = "en" | "hi";

/** Accessibility and comfort settings. Stored on the account so they follow the person to any device. */
export interface UserPreferences {
  largeText: boolean;
  /** Bigger buttons and more space between them */
  largeControls: boolean;
  /** Fewer sections and decorations: only the main actions */
  simplified: boolean;
  highContrast: boolean;
}
export const DEFAULT_PREFERENCES: UserPreferences = { largeText: false, largeControls: false, simplified: false, highContrast: false };

export interface User {
  id: string;
  name: string;
  email?: string;
  mobile: string;
  /** Customers and partners sign in with a one-time code and have no password. Staff and admins do. */
  passwordHash?: string;
  role: Role;
  /** Pharmacy (staff) or delivery-partner profile the account belongs to. Empty until a partner application is approved. */
  partnerId?: string;
  language: Language;
  /** Where the customer is (from onboarding). Used for the first search, never for tracking. */
  pincode?: string;
  district?: string;
  preferences: UserPreferences;
  consent: { healthData: boolean; marketing: boolean; acceptedAt?: string };
  /** ACTIVE accounts can sign in. SUSPENDED accounts are refused and their sessions are revoked. */
  status: "ACTIVE" | "SUSPENDED";
  mobileVerifiedAt?: string;
  /** Password-login attempt controls */
  failedLogins?: number;
  lockedUntil?: string;
  /** Multi-factor sign-in. Required for SUPER_ADMIN in production. */
  mfa?: { enabled: boolean; method: "SMS_OTP" | "TOTP" };
  createdAt: string;
}

export interface SessionUser {
  id: string;
  name: string;
  role: Role;
  partnerId?: string;
  /** The server-side session this request belongs to (set for requests that came through HTTP). */
  sessionId?: string;
  /** True for a short time after an admin re-confirmed their identity (see requireElevated). */
  elevated?: boolean;
}

/** One signed-in device. The cookie carries only the id; this record decides whether it is still valid. */
export interface Session {
  id: string;
  userId: string;
  kind: "STANDARD" | "ADMIN";
  createdAt: string;
  lastSeenAt: string;
  /** Hard stop: the session can never be refreshed past this */
  absoluteExpiresAt: string;
  /** Moves forward on refresh/activity; the session also dies when it passes */
  expiresAt: string;
  revokedAt?: string;
  revokedReason?: string;
  userAgent?: string;
  ip?: string;
  /** Admin MFA: false until the second factor is checked */
  mfaVerified: boolean;
  /** Sensitive admin actions need this to be in the future */
  elevatedUntil?: string;
}

export type OtpPurpose = "AUTH" | "ADMIN_MFA" | "ASSISTED_CONSENT";
/** A one-time code that was sent. Only a keyed hash is kept. */
export interface OtpChallenge {
  id: string;
  mobile: string;
  purpose: OtpPurpose;
  codeHash: string;
  attempts: number;
  maxAttempts: number;
  expiresAt: string;
  consumedAt?: string;
  /** Set once the code was entered wrongly too many times or a newer code replaced it */
  invalidatedAt?: string;
  /** For ADMIN_MFA / ASSISTED_CONSENT: who the code is bound to */
  subjectId?: string;
  ip?: string;
  createdAt: string;
}

/** Someone outside a live area who asked to be told when we arrive. */
export interface ServiceAreaInterest {
  id: string;
  mobile: string;
  pincode: string;
  district?: string;
  createdAt: string;
}

export type ApplicationType = "PHARMACY" | "RIDER";
export type ApplicationStatus = "DRAFT" | "SUBMITTED" | "UNDER_REVIEW" | "MORE_INFO_REQUIRED" | "APPROVED" | "REJECTED" | "SUSPENDED";

export interface ApplicationEvent {
  id: string;
  at: string;
  actorId: string;
  actorRole: Role | "SYSTEM";
  type: "STARTED" | "SAVED" | "DOCUMENT_UPLOADED" | "DOCUMENT_REMOVED" | "DOCUMENT_REVIEWED" | "SUBMITTED" | "REVIEW_STARTED" | "INFO_REQUESTED" | "APPROVED" | "REJECTED" | "SUSPENDED" | "REINSTATED" | "NOTE";
  fromStatus?: ApplicationStatus;
  toStatus?: ApplicationStatus;
  note?: string;
  /** Internal notes are visible to admins only, never to the applicant */
  internal?: boolean;
}

/** A pharmacy or rider application. The partner record (Pharmacy / DeliveryPartner) only exists after approval. */
export interface PartnerApplication {
  id: string;
  type: ApplicationType;
  userId: string;
  status: ApplicationStatus;
  /** Index of the step the applicant is on (resume where they left off) */
  step: number;
  /** Answers per step: { owner: {...}, store: {...} }. Saved as drafts, fully validated on submit. */
  data: Record<string, Record<string, unknown>>;
  events: ApplicationEvent[];
  /** Set on approval */
  partnerId?: string;
  createdAt: string;
  updatedAt: string;
  submittedAt?: string;
  decidedAt?: string;
  decidedBy?: string;
}

export type DocumentKind =
  | "DRUG_LICENSE" | "SHOP_IMAGE" | "PHARMACIST_CERTIFICATE" | "GST_CERTIFICATE" | "OTHER_BUSINESS"
  | "ID_PROOF" | "DRIVING_LICENSE" | "VEHICLE_RC" | "PROFILE_PHOTO";
export type DocumentStatus = "UPLOADED" | "APPROVED" | "REJECTED" | "REUPLOAD_REQUESTED";

/** A private file belonging to an application. The bytes live in private storage; only an opaque key is kept here. */
export interface PartnerDocument {
  id: string;
  applicationId: string;
  uploadedBy: string;
  kind: DocumentKind;
  label?: string;
  fileKey: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  status: DocumentStatus;
  reviewNote?: string;
  reviewedBy?: string;
  reviewedAt?: string;
  createdAt: string;
}

/** "Please call me" from someone who finds the app hard. No account needed. */
export interface CallbackRequest {
  id: string;
  mobile: string;
  name?: string;
  area: string;
  reason: string;
  status: "OPEN" | "CONTACTED" | "CLOSED";
  note?: string;
  handledBy?: string;
  createdAt: string;
}

/** Permission, given by the customer, for a verified pharmacy to place one order for them. */
export interface AssistedConsent {
  id: string;
  pharmacyId: string;
  requestedBy: string;
  customerUserId?: string;
  mobile: string;
  status: "PENDING" | "GRANTED" | "DENIED" | "EXPIRED" | "USED";
  challengeId: string;
  grantedAt?: string;
  expiresAt: string;
  orderId?: string;
  createdAt: string;
}

export type AnalyticsEventName =
  | "signup_started" | "otp_requested" | "otp_verified" | "location_selected" | "signup_completed"
  | "pharmacy_registration_started" | "pharmacy_application_submitted" | "pharmacy_approved" | "inventory_added"
  | "rider_registration_started" | "rider_application_submitted" | "first_order_completed";
export interface AnalyticsRecord {
  id: string;
  name: AnalyticsEventName;
  /** Signed-in person, or a random anonymous id. Never a mobile number, never anything medical. */
  userId?: string;
  anonId?: string;
  props?: Record<string, string | number | boolean>;
  at: string;
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
  /** "Leave it with the guard", "call when you arrive" */
  deliveryNotes?: string;
  isDefault?: boolean;
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
  /** Set up after approval: checklist items that cannot be worked out from other data */
  onboarding?: PharmacyOnboarding;
}

export interface PharmacyOnboarding {
  deliverySettingsDone: boolean;
  trainingDone: boolean;
  walkthroughSeen: boolean;
  /** Bank or UPI details for settlements. The account number is kept private and shown masked. */
  settlement?: { holderName: string; accountNumber?: string; ifsc?: string; upiId?: string; savedAt: string };
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
  /** Set when a verified pharmacy placed the order for the customer, with their consent */
  assisted?: { pharmacyId: string; staffUserId: string; consentId: string };
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
  | "MEDICINE_FOUND"
  | "APPLICATION_UPDATE";
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
