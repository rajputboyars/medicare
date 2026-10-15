/**
 * What each onboarding step looks like on screen. The SERVER decides what is required and valid (src/server/features/onboarding);
 * this only says how to draw the questions. Short labels, one hint, no jargon.
 */
export interface FieldDef {
  key: string;
  label: string;
  type?: "text" | "tel" | "email" | "date" | "number" | "select" | "checkbox" | "pincodes";
  hint?: string;
  options?: { value: string; label: string }[];
  /** Only show when this returns true (receives the answers of the same step) */
  when?: (v: Record<string, unknown>) => boolean;
  half?: boolean;
}

const STATES = ["Uttar Pradesh"];
const address = (shop: boolean): FieldDef[] => [
  { key: "address", label: shop ? "Shop address" : "House / street", hint: shop ? "Building, street" : undefined },
  { key: "area", label: "Area / mohalla", half: true, when: () => shop },
  { key: "town", label: "Town or village", half: true },
  { key: "district", label: "District", half: true },
  { key: "state", label: "State", type: "select", half: true, options: STATES.map((s) => ({ value: s, label: s })) },
  { key: "pincode", label: "Pincode", type: "tel", half: true },
  { key: "landmark", label: "Landmark", hint: "Example: Opposite the post office" },
];

export const FIELDS: Record<"PHARMACY" | "RIDER", Record<string, FieldDef[]>> = {
  PHARMACY: {
    owner: [{ key: "ownerName", label: "Owner's full name" }, { key: "email", label: "Email (optional)", type: "email" }],
    store: [
      { key: "storeName", label: "Pharmacy name" },
      { key: "storeType", label: "Type of store", type: "select", options: [{ value: "RETAIL", label: "Retail medical store" }, { value: "CHAIN_BRANCH", label: "Branch of a chain" }, { value: "CLINIC_PHARMACY", label: "Clinic pharmacy" }] },
      { key: "storePhone", label: "Shop phone (optional)", type: "tel" },
    ],
    address: address(true),
    license: [
      { key: "drugLicenseNumber", label: "Drug licence number" },
      { key: "validTill", label: "Valid till", type: "date", half: true },
      { key: "issuingState", label: "Issued by (state)", half: true },
      { key: "gstin", label: "GSTIN (optional)", hint: "15 characters" },
    ],
    pharmacist: [
      { key: "pharmacistName", label: "Pharmacist's name" },
      { key: "registrationNumber", label: "Pharmacy council registration number" },
      { key: "pharmacistMobile", label: "Pharmacist's mobile", type: "tel" },
    ],
    delivery: [
      { key: "servicePincodes", label: "Pincodes you deliver to", type: "pincodes", hint: "Type a pincode and press Add" },
      { key: "radiusKm", label: "Delivery distance (km)", type: "number", half: true },
      { key: "avgPrepMinutes", label: "Time to pack an order (minutes)", type: "number", half: true },
      { key: "openTime", label: "Opens at", hint: "24-hour, like 09:00", half: true },
      { key: "closeTime", label: "Closes at", hint: "24-hour, like 21:00", half: true },
      { key: "priorityDelivery", label: "I can do priority (fast) delivery", type: "checkbox" },
    ],
    inventory: [
      { key: "plan", label: "How will you add your medicines?", type: "select", options: [
        { value: "CSV_AFTER_APPROVAL", label: "Upload a file from my billing software" },
        { value: "MANUAL_AFTER_APPROVAL", label: "Add them one by one" },
        { value: "UPLOAD_LATER", label: "I will decide later" },
      ] },
      { key: "estimatedItems", label: "About how many medicines do you stock? (optional)", type: "number" },
    ],
  },
  RIDER: {
    personal: [
      { key: "fullName", label: "Full name" },
      { key: "dateOfBirth", label: "Date of birth", type: "date", hint: "You must be 18 or older" },
      { key: "emergencyContactName", label: "Emergency contact name", half: true },
      { key: "emergencyContactMobile", label: "Emergency contact mobile", type: "tel", half: true },
    ],
    address: address(false),
    serviceArea: [{ key: "servicePincodes", label: "Pincodes you can deliver in", type: "pincodes", hint: "Type a pincode and press Add" }],
    vehicle: [
      { key: "vehicleType", label: "Your vehicle", type: "select", options: [{ value: "BICYCLE", label: "Bicycle" }, { value: "SCOOTER", label: "Scooter" }, { value: "MOTORCYCLE", label: "Motorcycle" }] },
      { key: "vehicleNumber", label: "Vehicle number", when: (v) => v.vehicleType && v.vehicleType !== "BICYCLE", half: true },
      { key: "licenseNumber", label: "Driving licence number", when: (v) => v.vehicleType && v.vehicleType !== "BICYCLE", half: true },
    ],
    payment: [
      { key: "method", label: "How should we pay you?", type: "select", options: [{ value: "UPI", label: "UPI" }, { value: "BANK", label: "Bank account" }] },
      { key: "upiId", label: "UPI id", hint: "Example: name@bank", when: (v) => v.method === "UPI" },
      { key: "accountHolder", label: "Account holder name", when: (v) => v.method === "BANK" },
      { key: "accountNumber", label: "Account number", type: "tel", when: (v) => v.method === "BANK", half: true },
      { key: "ifsc", label: "IFSC code", when: (v) => v.method === "BANK", half: true },
    ],
  },
};

/** Review screen: which answers to show, in plain words */
export const REVIEW_LABELS: Record<string, string> = {
  ownerName: "Owner", email: "Email", storeName: "Pharmacy", storeType: "Type", storePhone: "Shop phone", address: "Address", area: "Area", town: "Town", district: "District", state: "State", pincode: "Pincode",
  landmark: "Landmark", drugLicenseNumber: "Drug licence", validTill: "Valid till", issuingState: "Issued by", gstin: "GSTIN", pharmacistName: "Pharmacist", registrationNumber: "Registration no.",
  pharmacistMobile: "Pharmacist mobile", servicePincodes: "Delivers to", radiusKm: "Distance (km)", avgPrepMinutes: "Packing time (min)", openTime: "Opens", closeTime: "Closes", priorityDelivery: "Priority delivery",
  plan: "Stock plan", estimatedItems: "Medicines", fullName: "Name", dateOfBirth: "Date of birth", emergencyContactName: "Emergency contact", emergencyContactMobile: "Emergency mobile",
  vehicleType: "Vehicle", vehicleNumber: "Vehicle number", licenseNumber: "Licence", method: "Payment", upiId: "UPI id", accountHolder: "Account holder", accountNumber: "Account number", ifsc: "IFSC",
};
