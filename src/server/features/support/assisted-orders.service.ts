import { DEFAULT_PREFERENCES, type AssistedConsent, type Order, type SessionUser, type User } from "@/lib/types";
import { badRequest, conflict, forbidden, notFound } from "@/server/errors";
import { audit, db, uid } from "@/server/store";
import { issueOtp, verifyOtp } from "../auth/otp.service";
import { saveAddress } from "../accounts/accounts.service";
import { notify } from "../notifications/notify";
import { createOrder } from "../orders/orders.service";
import { pharmacyOf } from "../pharmacy/pharmacy.service";
import type { Address } from "@/lib/types";

/**
 * Pharmacy-assisted ordering: a verified pharmacy places ONE order for a customer who is standing at the counter or on the
 * phone. It is built so it can never be used to act as somebody without their say-so, and there is no impersonation:
 *
 *   1. the pharmacy asks for consent for a mobile number          → a one-time code goes to the CUSTOMER's phone
 *   2. the customer reads the code out; the pharmacy enters it    → consent GRANTED for 30 minutes, for this pharmacy only
 *   3. the pharmacy places the order (over-the-counter medicines only, cash on delivery, their own stock)
 *   4. consent is USED and cannot place a second order
 *
 * The staff member never signs in as the customer and never sees the customer's other data. The order is marked `assisted`,
 * its first history row names the staff member, the customer is notified, and every step is in the audit log.
 */

export const CONSENT_TTL_MS = 30 * 60_000;
const OTP_STEP_TTL_MS = 10 * 60_000;

export function requestConsent(staff: SessionUser, input: { mobile: string }) {
  const pharmacy = pharmacyOf(staff);
  const d = db();
  const owner = d.users.find((u) => u.mobile === input.mobile);
  if (owner && owner.role !== "CUSTOMER") throw conflict("This number cannot be used for a customer order");
  if (owner?.status === "SUSPENDED") throw forbidden("This customer account is suspended");
  const { challenge, code } = issueOtp({ mobile: input.mobile, purpose: "ASSISTED_CONSENT", subjectId: pharmacy.id });
  const consent: AssistedConsent = {
    id: uid("ac"), pharmacyId: pharmacy.id, requestedBy: staff.id, customerUserId: owner?.id, mobile: input.mobile, status: "PENDING",
    challengeId: challenge.id, expiresAt: new Date(Date.now() + OTP_STEP_TTL_MS).toISOString(), createdAt: new Date().toISOString(),
  };
  d.assistedConsents.push(consent);
  audit(staff, "ASSISTED_CONSENT_REQUESTED", "AssistedConsent", consent.id, { pharmacyId: pharmacy.id });
  return { consent, code, isNewCustomer: !owner };
}

/** The customer's code, entered by the pharmacy. For a number with no account, the customer's name is needed to make one. */
export function grantConsent(staff: SessionUser, consentId: string, input: { code: string; customerName?: string }) {
  const pharmacy = pharmacyOf(staff);
  const d = db();
  const c = d.assistedConsents.find((x) => x.id === consentId);
  if (!c || c.pharmacyId !== pharmacy.id) throw notFound("Consent request not found");
  if (c.status !== "PENDING" || Date.parse(c.expiresAt) < Date.now()) { c.status = c.status === "PENDING" ? "EXPIRED" : c.status; throw conflict("This consent request is no longer open. Ask for a new code."); }
  verifyOtp({ challengeId: c.challengeId, code: input.code, purpose: "ASSISTED_CONSENT", mobile: c.mobile, subjectId: pharmacy.id });

  let customer = d.users.find((u) => u.mobile === c.mobile);
  if (!customer) {
    if (!input.customerName?.trim()) throw badRequest("Enter the customer's name", { customerName: "Enter the customer's name" });
    const t = new Date().toISOString();
    customer = {
      id: uid("u"), name: input.customerName.trim(), mobile: c.mobile, role: "CUSTOMER", language: "en", preferences: { ...DEFAULT_PREFERENCES },
      consent: { healthData: false, marketing: false, acceptedAt: t }, status: "ACTIVE", mobileVerifiedAt: t, createdAt: t,
    } satisfies User;
    d.users.push(customer);
    d.familyMembers.push({ id: uid("fm"), userId: customer.id, name: customer.name, age: 30, gender: "OTHER", relationship: "SELF", currentMedicines: [] });
  }
  c.customerUserId = customer.id;
  c.status = "GRANTED";
  c.grantedAt = new Date().toISOString();
  c.expiresAt = new Date(Date.now() + CONSENT_TTL_MS).toISOString();
  audit(staff, "ASSISTED_CONSENT_GRANTED", "AssistedConsent", c.id, { pharmacyId: pharmacy.id });
  return { consentId: c.id, expiresAt: c.expiresAt, customer: { id: customer.id, name: customer.name } };
}

export interface AssistedOrderInput {
  consentId: string;
  addressId?: string;
  newAddress?: Omit<Address, "id" | "userId">;
  items: { medicineId: string; quantity: number }[];
  deliveryType: "NORMAL" | "PRIORITY";
}

export function placeAssistedOrder(staff: SessionUser, input: AssistedOrderInput): Order {
  const pharmacy = pharmacyOf(staff);
  const d = db();
  const c = d.assistedConsents.find((x) => x.id === input.consentId);
  if (!c || c.pharmacyId !== pharmacy.id) throw notFound("Consent not found");
  if (c.status !== "GRANTED") throw conflict(c.status === "USED" ? "This consent was already used for an order." : "The customer has not given consent yet.");
  if (Date.parse(c.expiresAt) < Date.now()) { c.status = "EXPIRED"; throw conflict("This consent has expired. Ask the customer for a new code."); }
  const customer = d.users.find((u) => u.id === c.customerUserId);
  if (!customer || customer.status !== "ACTIVE") throw forbidden("This customer account is not available");

  // Over-the-counter only: prescriptions belong to the customer and are uploaded by them.
  for (const it of input.items) {
    const med = d.medicines.find((m) => m.id === it.medicineId);
    if (!med) throw badRequest("A medicine in the list does not exist");
    if (med.prescriptionRequired || med.restricted) throw badRequest(`${med.name} needs a prescription. The customer must order it from their own app.`);
  }
  let addressId = input.addressId;
  if (addressId && !d.addresses.some((a) => a.id === addressId && a.userId === customer.id)) throw forbidden("That address does not belong to this customer");
  if (!addressId) {
    if (!input.newAddress) throw badRequest("Add the delivery address");
    addressId = saveAddress(customer.id, input.newAddress).id;
    audit(staff, "ASSISTED_ADDRESS_ADDED", "Address", addressId, { consentId: c.id });
  }

  const order = createOrder({ id: customer.id, name: customer.name, role: "CUSTOMER" }, {
    pharmacyId: pharmacy.id, addressId, items: input.items, deliveryType: input.deliveryType, paymentMethod: "COD",
  });
  order.assisted = { pharmacyId: pharmacy.id, staffUserId: staff.id, consentId: c.id };
  // The first history row names who really placed it
  const first = d.orderStatusHistory.find((h) => h.orderId === order.id && !h.fromStatus);
  if (first) { first.changedBy = staff.id; first.actorRole = staff.role; first.note = "Placed by the pharmacy with the customer's consent"; }
  c.status = "USED";
  c.orderId = order.id;
  audit(staff, "ASSISTED_ORDER_CREATED", "Order", order.id, { consentId: c.id, customerUserId: customer.id });
  notify(customer.id, "ORDER_PLACED", "Order placed for you", `${pharmacy.name} placed order ${order.code} for you, as you agreed.`);
  return order;
}

export function assistedOrdersOf(staff: SessionUser) {
  const pharmacy = pharmacyOf(staff);
  return db().orders.filter((o) => o.assisted?.pharmacyId === pharmacy.id).map((o) => ({ id: o.id, code: o.code, status: o.status, total: o.total, createdAt: o.createdAt, placedBy: o.assisted!.staffUserId }));
}
