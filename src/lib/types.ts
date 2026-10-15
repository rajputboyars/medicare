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
  /** Pharmacies the customer marked as preferred. Shown as a badge; never used to hide other pharmacies. */
  favoritePharmacyIds?: string[];
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

/** A signed-in customer's recent searches. Private: only that customer can read or clear them. */
export interface SearchHistoryEntry { id: string; userId: string; query: string; at: string }

export type ImportRowStatus = "MATCHED" | "POSSIBLE_MATCH" | "NOT_FOUND" | "INVALID";
export interface ImportRow {
  line: number;
  status: ImportRowStatus;
  /** What the pharmacy typed (cleaned) */
  input: { medicineName: string; genericName?: string; strength?: string; manufacturer?: string; batch?: string; expiry?: string; mrp?: number; sellingPrice?: number; stock?: number };
  medicineId?: string;
  /** For POSSIBLE_MATCH: the candidates to choose from */
  candidates?: { medicineId: string; name: string; strength: string; score: number }[];
  errors?: string[];
  /** After confirm */
  outcome?: "IMPORTED" | "SENT_TO_REVIEW" | "SKIPPED";
}
export interface InventoryImport {
  id: string;
  pharmacyId: string;
  createdBy: string;
  status: "PREVIEW" | "CONFIRMED" | "CANCELLED";
  fileName: string;
  rows: ImportRow[];
  createdAt: string;
  confirmedAt?: string;
  imported?: number;
  sentToReview?: number;
}

/** An inventory line whose medicine is not in the master catalogue. Held for an admin: match it, create it, or reject it. */
export interface MedicineMatchReview {
  id: string;
  pharmacyId: string;
  importId: string;
  line: number;
  input: ImportRow["input"];
  candidates?: ImportRow["candidates"];
  status: "PENDING" | "MATCHED" | "CREATED" | "REJECTED";
  resolvedMedicineId?: string;
  note?: string;
  resolvedBy?: string;
  resolvedAt?: string;
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
  | "rider_registration_started" | "rider_application_submitted" | "first_order_completed"
  | "medicine_search" | "search_no_result" | "medicine_selected" | "availability_viewed" | "pharmacy_selected" | "medicine_added_to_cart" | "find_medicine_clicked";
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

export type DosageForm = "Tablet" | "Capsule" | "Syrup" | "Injection" | "Inhaler" | "Ointment" | "Drops" | "Device" | "Sachet";
export type MedicineStatus = "ACTIVE" | "INACTIVE";

/**
 * The MASTER catalogue: what a product IS. One record per product for the whole platform.
 * Pharmacies never get their own copy; their price, stock, batch and expiry live in PharmacyInventory.
 */
export interface Medicine {
  id: string;
  name: string;
  /** Lower-case, punctuation-free, digits split from letters: "Telma-40" → "telma 40". Derived on every save. */
  normalizedName: string;
  genericName: string;
  normalizedGenericName: string;
  brand: string;
  manufacturer: string;
  strength: string;
  dosageForm: DosageForm;
  packSize: string;
  category: MedicineCategory;
  /** Reference MRP for the pack. The selling MRP of a batch is on the inventory row. */
  mrp: number;
  prescriptionRequired: boolean;
  /** Restricted (e.g. Schedule H1/X): never orderable without an already-approved prescription. */
  restricted: boolean;
  /** Other names people use ("Dolo", "paracetamol 650") */
  searchAliases: string[];
  /** Extra words that should find this medicine (symptoms are NOT stored here: names and common spellings only) */
  searchKeywords: string[];
  image?: string;
  description?: string;
  /** INACTIVE medicines disappear from search and cannot be ordered, but old orders keep their snapshot */
  status: MedicineStatus;
  createdAt: string;
  updatedAt: string;
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
  /** When this stock line was last changed: shown to customers as "Updated 2h ago". (Spec name: lastStockUpdateAt) */
  lastUpdatedAt: string;
  /** INACTIVE rows are kept for history but never offered to customers */
  status?: InventoryStatus;
  updatedBy?: string;
  createdAt?: string;
  updatedAt?: string;
}

export type InventoryStatus = "ACTIVE" | "INACTIVE";
export type StockConfidence = "HIGH" | "MEDIUM" | "LOW";
export type ExpiryState = "EXPIRED" | "EXPIRING_30" | "EXPIRING_90" | "OK";

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

export const CANCEL_REASONS = ["CHANGED_MIND", "ORDERED_BY_MISTAKE", "TOO_SLOW", "FOUND_ELSEWHERE", "PAYMENT_ISSUE", "MEDICINE_UNAVAILABLE", "PRESCRIPTION_REJECTED", "CUSTOMER_DECLINED_PARTIAL", "NO_RESPONSE", "DELIVERY_FAILED", "ADDRESS_PROBLEM", "OTHER"] as const;
export type CancelReasonCode = (typeof CANCEL_REASONS)[number];

export interface PartialFulfillment {
  status: "PENDING_CUSTOMER" | "ACCEPTED" | "DECLINED" | "EXPIRED";
  unavailable: { itemId: string; name: string; quantity: number; reason: string }[];
  /** What the order would cost if the customer continues (computed by the server) */
  proposed: { subtotal: number; deliveryFee: number; discount: number; total: number };
  proposedBy: string;
  proposedAt: string;
  expiresAt: string;
  decidedAt?: string;
}
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
  /** The range shown to customers, e.g. [30, 40] */
  etaRange?: [number, number];
  deliveryPartnerId?: string;
  /** Which inventory batches hold this order's units, and whether they are reserved, consumed or given back. */
  stockAllocations: StockAllocation[];
  stockState: StockState;
  /** Unpaid online orders release their stock if payment does not arrive by this time. */
  paymentExpiresAt?: string;
  /** If nobody confirms the order by this time the reservation is released (see expireReservations) */
  reservationExpiresAt?: string;
  /** Offer code used, kept so totals can be recomputed if items are removed */
  offerCode?: string;
  platformFee: number;
  /** How the delivery fee was worked out: frozen at checkout */
  feeBreakdown?: { base: number; distanceCharge: number; prioritySurcharge: number; freeDelivery: boolean; distanceKm?: number; rule: "AREA" | "PLATFORM" };
  /** Structured cancellation record */
  cancelReasonCode?: CancelReasonCode;
  cancelledAt?: string;
  cancelledByUserId?: string;
  /** A customer's request to cancel once the pharmacy started preparing: staff or support decide */
  cancellationRequest?: { reasonCode: CancelReasonCode; note?: string; requestedAt: string; status: "PENDING" | "APPROVED" | "REJECTED"; decidedBy?: string; decidedAt?: string; decisionNote?: string };
  /** The pharmacy cannot supply some items: the customer must say continue or cancel */
  partialFulfillment?: PartialFulfillment;
  removedItems?: (OrderItem & { removedReason: string })[];
  refundStatus: RefundStatus;
  idempotencyKey?: string;
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
  /** Pincodes this rider covers. Missing = no restriction. Set from the approved application. */
  servicePincodes?: string[];
  joinedAt: string;
}

export type RiderStatus = "OFFLINE" | "AVAILABLE" | "BUSY" | "SUSPENDED";
/**
 * Delivery has its own states, kept in step with the order by domain services (never by the client):
 *   WAITING_FOR_RIDER → ASSIGNED → AT_PHARMACY → PICKED_UP → OUT_FOR_DELIVERY → DELIVERED
 *   OUT_FOR_DELIVERY → DELIVERY_FAILED → (retry) OUT_FOR_DELIVERY | RETURNING_TO_PHARMACY → RETURNED_TO_PHARMACY
 *   CANCELLED: the order was cancelled before the parcel left the pharmacy
 */
export type DeliveryStatus = "WAITING_FOR_RIDER" | "ASSIGNED" | "AT_PHARMACY" | "PICKED_UP" | "OUT_FOR_DELIVERY" | "DELIVERY_FAILED" | "RETURNING_TO_PHARMACY" | "RETURNED_TO_PHARMACY" | "DELIVERED" | "CANCELLED";
export type FailureReason = "CUSTOMER_UNAVAILABLE" | "WRONG_ADDRESS" | "CUSTOMER_REFUSED" | "UNABLE_TO_CONTACT" | "UNSAFE_LOCATION" | "RIDER_ISSUE" | "OTHER";
export const FAILURE_REASONS: readonly FailureReason[] = ["CUSTOMER_UNAVAILABLE", "WRONG_ADDRESS", "CUSTOMER_REFUSED", "UNABLE_TO_CONTACT", "UNSAFE_LOCATION", "RIDER_ISSUE", "OTHER"];

export interface Delivery {
  id: string;
  orderId: string;
  /** Empty while WAITING_FOR_RIDER */
  partnerId?: string;
  status: DeliveryStatus;
  payout: number;
  cashToCollect: number;
  /** One-time codes are never stored. We keep a keyed hash, a nonce and a failed-attempt counter per code. */
  pickupOtpHash: string;
  deliveryOtpHash: string;
  /** Delivery code nonce (the pickup code has its own, so it can be re-issued without changing the delivery code) */
  otpNonce: string;
  pickupOtpNonce?: string;
  /** The pickup code is short-lived; the pharmacy can issue a fresh one */
  pickupOtpExpiresAt?: string;
  pickupAttempts: number;
  deliveryAttempts: number;
  /** Which attempt at the customer's door this is (1 = first) */
  attemptNo?: number;
  failureReasonCode?: FailureReason;
  failureReason?: string;
  failedAt?: string;
  returnStartedAt?: string;
  returnedAt?: string;
  /** Cash handed over at the door (COD). Must equal cashToCollect before the delivery can be completed. */
  cashCollectedAmount?: number;
  cashCollectedAt?: string;
  /** Only the LATEST rider position, rounded for the customer view. Overwritten, never accumulated, cleared when the delivery ends. */
  lastLocation?: { lat: number; lng: number; at: string };
  /** What the rider earns, split so settlements can show it */
  earning?: { base: number; distance: number; incentive: number };
  distanceKm?: number;
  settlementId?: string;
  createdAt: string;
  acceptedAt?: string;
  atPharmacyAt?: string;
  pickedUpAt?: string;
  outForDeliveryAt?: string;
  deliveredAt?: string;
}

/**
 * One payment per order. Which gateway took it, and what the gateway calls it, are recorded here and on the attempts,
 * never on the order, so the order model does not depend on any provider.
 */
export interface Payment {
  id: string;
  orderId: string;
  userId: string;
  method: PaymentMethod;
  /** "COD", "MOCK", "RAZORPAY"... any registered provider */
  provider: string;
  amount: number;
  currency: "INR";
  refundedAmount: number;
  status: PaymentStatus;
  providerOrderId?: string;
  providerPaymentId?: string;
  paidAt?: string;
  /** COD only: the cash was handed to the rider */
  codCollectedAt?: string;
  codCollectedAmount?: number;
  createdAt: string;
  updatedAt: string;
}

/** Every try to pay is its own row, so a retry never creates a second order or a second payment. */
export interface PaymentAttempt {
  id: string;
  paymentId: string;
  orderId: string;
  attemptNumber: number;
  provider: string;
  providerOrderId?: string;
  providerPaymentId?: string;
  amount: number;
  status: "CREATED" | "PENDING" | "SUCCEEDED" | "FAILED" | "EXPIRED";
  failureCode?: string;
  failureMessage?: string;
  createdAt: string;
}

export type RefundStatus = "NOT_REQUIRED" | "PENDING" | "PROCESSING" | "COMPLETED" | "FAILED" | "PARTIAL";

export interface Refund {
  id: string;
  paymentId: string;
  orderId: string;
  amount: number;
  /** PENDING → PROCESSING → COMPLETED / FAILED. (PARTIAL describes the ORDER when only part of the payment came back.) */
  status: Exclude<RefundStatus, "NOT_REQUIRED" | "PARTIAL">;
  reason: string;
  kind: "FULL" | "PARTIAL";
  requestedBy: string;
  actorRole: Role | "SYSTEM";
  /** Same key = same refund: asking twice never refunds twice */
  idempotencyKey: string;
  providerRefundId?: string;
  failureMessage?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

/** A remembered answer for a request that carried an Idempotency-Key (or a webhook event id). */
export interface IdempotencyRecord {
  id: string;
  scope: string;
  key: string;
  userId?: string;
  /** Hash of what was asked, so the same key with different content is refused instead of replayed */
  fingerprint: string;
  status: number;
  response: unknown;
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
  /** PENDING (waiting out the hold) → ELIGIBLE → PROCESSING → PAID | FAILED. ON_HOLD can be set while something is disputed. */
  status: SettlementStatus;
  /** Pharmacy: medicine revenue, discount allocation, commission, refund adjustment. Rider: base, distance, incentive, adjustment. */
  components?: SettlementComponents;
  orderIds?: string[];
  deliveryIds?: string[];
  adjustments?: { id: string; amount: number; reason: string; by: string; at: string }[];
  eligibleAt?: string;
  paidAt?: string;
  holdReason?: string;
  createdAt: string;
}
export type SettlementStatus = "PENDING" | "ELIGIBLE" | "PROCESSING" | "PAID" | "ON_HOLD" | "FAILED";
export interface SettlementComponents {
  medicineRevenue?: number;
  discountAllocation?: number;
  platformCommission?: number;
  refundAdjustment?: number;
  baseEarning?: number;
  distanceEarning?: number;
  incentive?: number;
  adjustment: number;
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
  | "APPLICATION_UPDATE"
  | "PRESCRIPTION_REJECTED"
  | "ORDER_PREPARING"
  | "ORDER_READY"
  | "PAYMENT_RECEIVED"
  | "PAYMENT_FAILED"
  | "REFUND_INITIATED"
  | "REFUND_COMPLETED"
  | "REFUND_FAILED"
  | "DELIVERY_FAILED"
  | "ORDER_PARTIAL_PROPOSED"
  | "SUPPORT_ALERT";
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
  /** Delivery pricing for this area. Missing fields fall back to the platform settings. */
  feeRule?: DeliveryFeeRule;
}

export interface DeliveryFeeRule {
  baseFee: number;
  includedDistanceKm: number;
  perKmFee: number;
  prioritySurcharge: number;
  minFee: number;
  maxFee?: number;
  /** Beyond this distance from the pharmacy we do not deliver */
  maxServiceRadiusKm: number;
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
  /** Flat platform fee per order (0 by default) */
  platformFee?: number;
  /** Largest order we accept as cash on delivery */
  codMaxAmount?: number;
  /** Rider earning on top of the base payout, per km beyond the first */
  riderPerKm?: number;
  /** How many deliveries one rider may hold at once */
  maxConcurrentDeliveries?: number;
  /** Hours after delivery before a settlement becomes ELIGIBLE */
  settlementHoldHours?: number;
  /** How much of an offer's discount the platform pays (the rest comes out of the pharmacy's revenue) */
  discountPlatformSharePercent?: number;
  /** Minutes a customer has to answer a "some items are unavailable" proposal */
  partialProposalMinutes?: number;
  /** Minutes a customer has to pay (and retry) before the reservation is released */
  paymentWindowMinutes?: number;
  /** Delivery time estimate ingredients */
  eta?: { riderAssignMinutes: number; noRiderMinutes: number; reviewMinutes: number; normalKmPerMin: number; priorityKmPerMin: number; minMinutes: number; rangeFactor: number };
}

export interface AuditLog {
  id: string;
  actorId: string;
  actorRole: Role | "SYSTEM";
  action: string;
  /** entityType / entityId */
  targetType: string;
  targetId: string;
  /** State before and after a sensitive change (cancellation, refund, payment, settlement adjustment...) */
  before?: unknown;
  after?: unknown;
  meta?: Record<string, unknown>;
  at: string;
}
