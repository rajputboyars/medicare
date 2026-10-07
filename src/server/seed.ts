import bcrypt from "bcryptjs";
import type * as T from "@/lib/types";
import { STOCK_RESERVED_FROM } from "@/lib/order-machine";

/**
 * Realistic DEMO data. All names, licences and phone numbers are fictional.
 * Demo password for every seeded account: Demo@1234  (development-only test value).
 */
export const DEMO_PASSWORD = "Demo@1234";

export interface Db {
  users: T.User[];
  familyMembers: T.FamilyMember[];
  addresses: T.Address[];
  medicines: T.Medicine[];
  pharmacies: T.Pharmacy[];
  inventory: T.PharmacyInventory[];
  prescriptions: T.Prescription[];
  carts: T.Cart[];
  orders: T.Order[];
  deliveryPartners: T.DeliveryPartner[];
  deliveries: T.Delivery[];
  payments: T.Payment[];
  settlements: T.Settlement[];
  medicineRequests: T.MedicineRequest[];
  medicineRequestResponses: T.MedicineRequestResponse[];
  reviews: T.Review[];
  notifications: T.Notification[];
  tickets: T.SupportTicket[];
  serviceAreas: T.ServiceArea[];
  savedMedicines: T.SavedMedicine[];
  offers: T.Offer[];
  settings: (T.PlatformSettings & { id: string })[];
  audit: T.AuditLog[];
  files: Map<string, { bytes: Uint8Array; mimeType: string; ownerId: string }>;
}

export const DEFAULT_SETTINGS: T.PlatformSettings & { id: string } = {
  id: "platform",
  commissionPercent: 8,
  normalDeliveryFee: 25,
  priorityDeliveryFee: 49,
  freeDeliveryAbove: 499,
  riderPayoutNormal: 45,
  riderPayoutPriority: 70,
  supportPhone: "+911800000000",
};

const hoursAgo = (n: number) => new Date(Date.now() - n * 3600_000).toISOString();
const daysAhead = (n: number) => new Date(Date.now() + n * 86400_000).toISOString();

type M = Omit<T.Medicine, "id">;
export const MEDS: M[] = [
  { name: "Metformin 500", generic: "Metformin", brand: "Glycomet", strength: "500 mg", form: "Tablet", packSize: "20 tablets", category: "Diabetes", mrp: 32, prescriptionRequired: true, restricted: false },
  { name: "Glimepiride 1", generic: "Glimepiride", brand: "Amaryl", strength: "1 mg", form: "Tablet", packSize: "30 tablets", category: "Diabetes", mrp: 118, prescriptionRequired: true, restricted: false },
  { name: "Telmisartan 40", generic: "Telmisartan", brand: "Telma", strength: "40 mg", form: "Tablet", packSize: "30 tablets", category: "Blood Pressure", mrp: 142, prescriptionRequired: true, restricted: false },
  { name: "Amlodipine 5", generic: "Amlodipine", brand: "Amlong", strength: "5 mg", form: "Tablet", packSize: "30 tablets", category: "Blood Pressure", mrp: 58, prescriptionRequired: true, restricted: false },
  { name: "Thyronorm 50", generic: "Levothyroxine", brand: "Thyronorm", strength: "50 mcg", form: "Tablet", packSize: "100 tablets", category: "Thyroid", mrp: 218, prescriptionRequired: true, restricted: false },
  { name: "Asthalin Inhaler", generic: "Salbutamol", brand: "Asthalin", strength: "100 mcg/dose", form: "Inhaler", packSize: "200 doses", category: "Asthma", mrp: 168, prescriptionRequired: true, restricted: false },
  { name: "Paracetamol 650", generic: "Paracetamol", brand: "Dolo", strength: "650 mg", form: "Tablet", packSize: "15 tablets", category: "Pain & Fever", mrp: 33, prescriptionRequired: false, restricted: false },
  { name: "Crocin Advance", generic: "Paracetamol", brand: "Crocin", strength: "500 mg", form: "Tablet", packSize: "15 tablets", category: "Pain & Fever", mrp: 24, prescriptionRequired: false, restricted: false },
  { name: "Ibuprofen 400", generic: "Ibuprofen", brand: "Brufen", strength: "400 mg", form: "Tablet", packSize: "15 tablets", category: "Pain & Fever", mrp: 28, prescriptionRequired: false, restricted: false },
  { name: "Amoxicillin 500", generic: "Amoxicillin", brand: "Mox", strength: "500 mg", form: "Capsule", packSize: "10 capsules", category: "Antibiotic", mrp: 74, prescriptionRequired: true, restricted: false },
  { name: "Azithromycin 500", generic: "Azithromycin", brand: "Azithral", strength: "500 mg", form: "Tablet", packSize: "5 tablets", category: "Antibiotic", mrp: 118, prescriptionRequired: true, restricted: false },
  { name: "Alprazolam 0.25", generic: "Alprazolam", brand: "Alprax", strength: "0.25 mg", form: "Tablet", packSize: "10 tablets", category: "Mental Health", mrp: 24, prescriptionRequired: true, restricted: true },
  { name: "Pantoprazole 40", generic: "Pantoprazole", brand: "Pan", strength: "40 mg", form: "Tablet", packSize: "15 tablets", category: "Stomach", mrp: 168, prescriptionRequired: true, restricted: false },
  { name: "ORS Electral", generic: "Oral Rehydration Salts", brand: "Electral", strength: "21.8 g", form: "Sachet", packSize: "5 sachets", category: "Stomach", mrp: 40, prescriptionRequired: false, restricted: false },
  { name: "Cetirizine 10", generic: "Cetirizine", brand: "Okacet", strength: "10 mg", form: "Tablet", packSize: "10 tablets", category: "Cold & Cough", mrp: 22, prescriptionRequired: false, restricted: false },
  { name: "Benadryl Cough Syrup", generic: "Diphenhydramine", brand: "Benadryl", strength: "150 ml", form: "Syrup", packSize: "150 ml", category: "Cold & Cough", mrp: 98, prescriptionRequired: false, restricted: false },
  { name: "Vitamin D3 60K", generic: "Cholecalciferol", brand: "Uprise-D3", strength: "60000 IU", form: "Capsule", packSize: "4 capsules", category: "Vitamins", mrp: 130, prescriptionRequired: false, restricted: false },
  { name: "Betadine Ointment", generic: "Povidone Iodine", brand: "Betadine", strength: "5%", form: "Ointment", packSize: "20 g", category: "Skin", mrp: 86, prescriptionRequired: false, restricted: false },
  { name: "Digital Thermometer", generic: "Thermometer", brand: "Dr Morepen", strength: "—", form: "Device", packSize: "1 unit", category: "Health Essentials", mrp: 210, prescriptionRequired: false, restricted: false },
  { name: "Insulin Glargine Pen", generic: "Insulin Glargine", brand: "Basalog", strength: "100 IU/ml", form: "Injection", packSize: "3 ml pen", category: "Diabetes", mrp: 640, prescriptionRequired: true, restricted: false },
];

/** Stable ids used by tests and the smoke script. */
export const MED = {
  METFORMIN: "med_1", TELMISARTAN: "med_3", AMLODIPINE: "med_4", THYRONORM: "med_5", PARACETAMOL: "med_7", CROCIN: "med_8",
  IBUPROFEN: "med_9", ALPRAZOLAM: "med_12", ORS: "med_14", CETIRIZINE: "med_15", VITAMIN_D: "med_17", THERMOMETER: "med_19", INSULIN: "med_20",
} as const;

function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}

// 1×1 PNG so the prescription viewer has something real to open in the demo.
const PNG_1PX = Uint8Array.from(Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000001e221bc330000000049454e44ae426082", "hex"));

export function buildSeed(): Db {
  const hash = bcrypt.hashSync(DEMO_PASSWORD, 8);
  const consent = { healthData: true, marketing: false, acceptedAt: hoursAgo(24 * 30) };
  const medicines: T.Medicine[] = MEDS.map((m, i) => ({ ...m, id: `med_${i + 1}` }));

  // ---------- Pharmacies (4 verified, 1 pending KYC) ----------
  const pharmacies: T.Pharmacy[] = [
    { id: "ph_1", name: "Shree Ram Medical Store", ownerName: "Ramesh Gupta", mobile: "9811100001", drugLicense: "UP-SIT-20-4411 (demo)", verification: "VERIFIED", address: "Main Bazaar, near Clock Tower, Sitapur", pincode: "261001", district: "Sitapur", location: { lat: 27.5683, lng: 80.6827 }, servicePincodes: ["261001", "261121"], deliveryRadiusKm: 8, openTime: "08:00", closeTime: "22:00", priorityDelivery: true, avgPrepMinutes: 10, rating: 4.6, ratingCount: 212, acceptingOrders: true },
    { id: "ph_2", name: "Jan Seva Pharmacy", ownerName: "Sunita Agrawal", mobile: "9811100002", drugLicense: "UP-SIT-19-3187 (demo)", verification: "VERIFIED", address: "Station Road, opp. Govt. Inter College", pincode: "261001", district: "Sitapur", location: { lat: 27.5741, lng: 80.6912 }, servicePincodes: ["261001", "261125"], deliveryRadiusKm: 6, openTime: "07:30", closeTime: "23:00", priorityDelivery: true, avgPrepMinutes: 12, rating: 4.4, ratingCount: 148, acceptingOrders: true },
    { id: "ph_3", name: "Arogya Medicos", ownerName: "Dr. Imran Khan", mobile: "9811100003", drugLicense: "UP-SIT-21-5502 (demo)", verification: "VERIFIED", address: "Civil Lines, behind District Court", pincode: "261121", district: "Sitapur", location: { lat: 27.5522, lng: 80.6694 }, servicePincodes: ["261121", "261001"], deliveryRadiusKm: 10, openTime: "09:00", closeTime: "21:00", priorityDelivery: false, avgPrepMinutes: 15, rating: 4.7, ratingCount: 96, acceptingOrders: true },
    { id: "ph_4", name: "Maa Durga Chemist", ownerName: "Pawan Mishra", mobile: "9811100004", drugLicense: "UP-SIT-18-2290 (demo)", verification: "VERIFIED", address: "Mohalla Kaziyana, near Hanuman Mandir", pincode: "261125", district: "Sitapur", location: { lat: 27.5905, lng: 80.7101 }, servicePincodes: ["261125", "261001"], deliveryRadiusKm: 7, openTime: "08:30", closeTime: "21:30", priorityDelivery: true, avgPrepMinutes: 10, rating: 4.3, ratingCount: 71, acceptingOrders: true },
    { id: "ph_5", name: "New Life Medical Hall", ownerName: "Anil Tiwari", mobile: "9811100005", drugLicense: "UP-SIT-24-7781 (demo)", verification: "PENDING", address: "Bus Stand Road, Sitapur", pincode: "261001", district: "Sitapur", location: { lat: 27.5701, lng: 80.6789 }, servicePincodes: ["261001"], deliveryRadiusKm: 5, openTime: "09:00", closeTime: "21:00", priorityDelivery: false, avgPrepMinutes: 15, rating: 0, ratingCount: 0, acceptingOrders: false },
  ];

  // ---------- Inventory (pharmacy-specific) ----------
  const r = rng(42);
  const inventory: T.PharmacyInventory[] = [];
  const stockRates: Record<string, number> = { ph_1: 0.92, ph_2: 0.78, ph_3: 0.62, ph_4: 0.52 };
  for (const p of pharmacies.filter((x) => x.verification === "VERIFIED")) {
    for (const m of medicines) {
      if (m.id === MED.INSULIN && p.id !== "ph_1") continue; // rare item: only one pharmacy, so "Find This Medicine For Me" has a story
      if (r() > stockRates[p.id]) continue;
      inventory.push({
        id: `inv_${inventory.length + 1}`, pharmacyId: p.id, medicineId: m.id, batch: `B${Math.floor(r() * 9000 + 1000)}`,
        expiry: daysAhead(120 + Math.floor(r() * 500)), mrp: m.mrp, sellingPrice: Math.round(m.mrp * (0.88 + r() * 0.1)),
        quantity: r() < 0.12 ? Math.floor(r() * 6) : 25 + Math.floor(r() * 80), lowStockThreshold: 10,
      });
    }
  }
  const forceStock = (phId: string, medId: string, qty: number) => {
    const row = inventory.find((i) => i.pharmacyId === phId && i.medicineId === medId);
    const med = medicines.find((m) => m.id === medId)!;
    if (row) row.quantity = Math.max(row.quantity, qty);
    else inventory.push({ id: `inv_${inventory.length + 1}`, pharmacyId: phId, medicineId: medId, batch: "B1001", expiry: daysAhead(300), mrp: med.mrp, sellingPrice: Math.round(med.mrp * 0.92), quantity: qty, lowStockThreshold: 10 });
  };
  for (const id of [MED.METFORMIN, MED.TELMISARTAN, MED.AMLODIPINE, MED.THYRONORM, MED.PARACETAMOL, MED.CROCIN, MED.ORS, MED.CETIRIZINE, MED.VITAMIN_D, MED.IBUPROFEN]) forceStock("ph_1", id, 80);
  for (const id of [MED.METFORMIN, MED.PARACETAMOL, MED.ORS, MED.CETIRIZINE, MED.VITAMIN_D]) forceStock("ph_2", id, 60);
  forceStock("ph_3", MED.METFORMIN, 40);
  forceStock("ph_4", MED.PARACETAMOL, 40);
  forceStock("ph_1", MED.INSULIN, 8);
  forceStock("ph_1", MED.THERMOMETER, 12);
  const low = inventory.find((i) => i.pharmacyId === "ph_1" && i.medicineId === MED.THYRONORM);
  if (low) low.quantity = 4; // deliberate low-stock alert
  forceStock("ph_1", MED.ALPRAZOLAM, 20); // restricted item, to demonstrate the guard

  // ---------- Users ----------
  const mkUser = (id: string, name: string, mobile: string, email: string | undefined, role: T.Role, partnerId?: string, lang: "en" | "hi" = "en"): T.User =>
    ({ id, name, mobile, email, passwordHash: hash, role, partnerId, language: lang, consent, createdAt: hoursAgo(24 * 90) });
  const users: T.User[] = [
    mkUser("u_1", "Asha Verma", "9876543210", "asha@example.com", "CUSTOMER"),
    mkUser("u_2", "Rajesh Kumar", "9876500002", "rajesh@example.com", "CUSTOMER", undefined, "hi"),
    mkUser("u_3", "Priya Singh", "9876500003", "priya@example.com", "CUSTOMER"),
    mkUser("u_4", "Mohammad Salim", "9876500004", "salim@example.com", "CUSTOMER", undefined, "hi"),
    mkUser("u_5", "Sunita Devi", "9876500005", "sunita@example.com", "CUSTOMER", undefined, "hi"),
    mkUser("u_ph", "Ramesh Gupta", "9811100001", "pharmacy@example.com", "PHARMACY_ADMIN", "ph_1"),
    mkUser("u_rx", "Kavita Singh (Pharmacist)", "9811100011", "pharmacist@example.com", "PHARMACIST", "ph_1"),
    mkUser("u_ph2", "Sunita Agrawal", "9811100002", "pharmacy2@example.com", "PHARMACY_ADMIN", "ph_2"),
    mkUser("u_dp1", "Sonu Yadav", "9822200001", "rider@example.com", "DELIVERY_PARTNER", "dp_1", "hi"),
    mkUser("u_dp2", "Deepak Rawat", "9822200002", "rider2@example.com", "DELIVERY_PARTNER", "dp_2", "hi"),
    mkUser("u_dp3", "Imran Ali", "9822200003", "rider3@example.com", "DELIVERY_PARTNER", "dp_3", "hi"),
    mkUser("u_dp4", "Vikas Pal", "9822200004", "rider4@example.com", "DELIVERY_PARTNER", "dp_4", "hi"),
    mkUser("u_dp5", "Ajay Tiwari", "9822200005", "rider5@example.com", "DELIVERY_PARTNER", "dp_5", "hi"),
    mkUser("u_ad", "Platform Admin", "9800000001", "admin@example.com", "SUPER_ADMIN"),
  ];

  const familyMembers: T.FamilyMember[] = [
    { id: "fm_1", userId: "u_1", name: "Asha Verma", age: 38, gender: "FEMALE", relationship: "SELF", bloodGroup: "B+", currentMedicines: [], preferredPharmacyId: "ph_1" },
    { id: "fm_2", userId: "u_1", name: "Mohan Verma", age: 67, gender: "MALE", relationship: "FATHER", bloodGroup: "O+", allergies: "Penicillin", currentMedicines: ["Metformin 500", "Telmisartan 40"], preferredPharmacyId: "ph_1" },
    { id: "fm_3", userId: "u_1", name: "Savitri Verma", age: 64, gender: "FEMALE", relationship: "MOTHER", currentMedicines: ["Thyronorm 50"], preferredPharmacyId: "ph_2" },
    { id: "fm_4", userId: "u_1", name: "Aarav Verma", age: 7, gender: "MALE", relationship: "CHILD", currentMedicines: [] },
    { id: "fm_5", userId: "u_2", name: "Rajesh Kumar", age: 45, gender: "MALE", relationship: "SELF", currentMedicines: ["Amlodipine 5"] },
    { id: "fm_6", userId: "u_3", name: "Priya Singh", age: 31, gender: "FEMALE", relationship: "SELF", currentMedicines: [] },
    { id: "fm_7", userId: "u_4", name: "Mohammad Salim", age: 58, gender: "MALE", relationship: "SELF", currentMedicines: [] },
    { id: "fm_8", userId: "u_5", name: "Sunita Devi", age: 52, gender: "FEMALE", relationship: "SELF", currentMedicines: [] },
  ];

  const addr = (id: string, userId: string, label: string, name: string, mobile: string, pincode: string, town: string, area: string, landmark: string, house: string, loc: T.GeoPoint, village?: string): T.Address =>
    ({ id, userId, label, contactName: name, contactMobile: mobile, pincode, state: "Uttar Pradesh", district: "Sitapur", town, village, area, landmark, houseDescription: house, location: loc });
  const addresses: T.Address[] = [
    addr("ad_1", "u_1", "Home", "Asha Verma", "9876543210", "261001", "Sitapur", "Mohalla Kaziyana", "Near Hanuman Mandir, opposite Government School", "Blue gate, 2nd house after the tea stall", { lat: 27.5712, lng: 80.6878 }),
    addr("ad_2", "u_1", "Village house", "Mohan Verma", "9876543211", "261125", "Biswan", "Purani Abadi", "Behind the panchayat bhawan, next to the pond", "Yellow house with neem tree", { lat: 27.5951, lng: 80.7155 }, "Rampur Kalan"),
    addr("ad_3", "u_2", "Home", "Rajesh Kumar", "9876500002", "261001", "Sitapur", "Station Road", "Opposite the old petrol pump", "Green shutter shop with flat above", { lat: 27.5735, lng: 80.6902 }),
    addr("ad_4", "u_3", "Home", "Priya Singh", "9876500003", "261121", "Sitapur", "Civil Lines", "Behind the District Court, near the post office", "House no. 14, white boundary wall", { lat: 27.5531, lng: 80.6702 }),
    addr("ad_5", "u_4", "Home", "Mohammad Salim", "9876500004", "261001", "Sitapur", "Chowk Bazaar", "Next to the Jama Masjid gate", "Second floor above cloth shop", { lat: 27.5668, lng: 80.6810 }),
    addr("ad_6", "u_5", "Home", "Sunita Devi", "9876500005", "261125", "Biswan", "Naya Ganj", "Near the Shiv temple and water tank", "Brick house, red door", { lat: 27.5920, lng: 80.7090 }),
  ];

  const settings = DEFAULT_SETTINGS;
  const med = (id: string) => medicines.find((m) => m.id === id)!;
  const priceAt = (phId: string, medId: string) => inventory.find((i) => i.pharmacyId === phId && i.medicineId === medId)?.sellingPrice ?? med(medId).mrp;
  const snap = (a: T.Address) => { const { id: _i, userId: _u, ...rest } = a; void _i; void _u; return rest; };

  // ---------- Sample orders across the state machine ----------
  const orders: T.Order[] = [];
  const deliveries: T.Delivery[] = [];
  const payments: T.Payment[] = [];
  let seq = 0;
  interface Spec { userId: string; fm?: string; ph: string; ad: string; items: [string, number][]; status: T.OrderStatus; ageH: number; pay: T.PaymentMethod; paid?: boolean; type?: T.DeliveryType; rx?: string; rider?: string; reason?: string; by?: T.Role }
  function order(s: Spec, code: string) {
    seq++;
    const id = `ord_${seq}`;
    const a = addresses.find((x) => x.id === s.ad)!;
    const items: T.OrderItem[] = s.items.map(([m, q], i) => ({ id: `${id}_i${i + 1}`, orderId: id, medicineId: m, name: med(m).name, strength: med(m).strength, quantity: q, mrp: med(m).mrp, unitPrice: priceAt(s.ph, m), prescriptionRequired: med(m).prescriptionRequired }));
    const subtotal = items.reduce((t, i) => t + i.unitPrice * i.quantity, 0);
    const type = s.type ?? "NORMAL";
    const fee = type === "PRIORITY" ? settings.priorityDeliveryFee : subtotal >= settings.freeDeliveryAbove ? 0 : settings.normalDeliveryFee;
    const rxOrder = items.some((i) => i.prescriptionRequired);
    const path: T.OrderStatus[] = [...(rxOrder ? (["PRESCRIPTION_REVIEW", "PRESCRIPTION_APPROVED"] as const) : (["PENDING"] as const)), "CONFIRMED", "PREPARING", "READY_FOR_PICKUP", "RIDER_ASSIGNED", "PICKED_UP", "OUT_FOR_DELIVERY", "DELIVERED"];
    const upto = s.status === "CANCELLED" ? path.indexOf(rxOrder ? "PRESCRIPTION_REVIEW" : "PENDING") : path.indexOf(s.status);
    const step = s.ageH / (Math.max(upto, 0) + 2);
    const statusHistory: T.StatusEvent[] = path.slice(0, upto + 1).map((st, i) => ({ status: st, at: hoursAgo(s.ageH - step * i), by: i === 0 ? "CUSTOMER" : "PHARMACIST" }));
    if (s.status === "CANCELLED") statusHistory.push({ status: "CANCELLED", at: hoursAgo(s.ageH / 2), note: s.reason, by: s.by });
    const paymentStatus: T.PaymentStatus = s.status === "CANCELLED" ? (s.paid ? "REFUNDED" : s.pay === "COD" ? "COD_DUE" : "FAILED") : s.pay === "COD" ? (s.status === "DELIVERED" ? "PAID" : "COD_DUE") : s.paid === false ? "PENDING" : "PAID";
    const reserved = STOCK_RESERVED_FROM.includes(s.status);
    const o: T.Order = {
      id, code, userId: s.userId, familyMemberId: s.fm, pharmacyId: s.ph, addressId: a.id, addressSnapshot: snap(a), items, prescriptionId: s.rx,
      status: s.status, statusHistory, deliveryType: type, subtotal, deliveryFee: fee, discount: 0, total: subtotal + fee, paymentMethod: s.pay, paymentStatus,
      etaMinutes: type === "PRIORITY" ? 28 : 42, deliveryOtp: String(4000 + seq * 137).slice(0, 4), pickupOtp: String(1000 + seq * 211).slice(0, 4),
      deliveryPartnerId: s.rider, stockReserved: reserved, cancelReason: s.reason, cancelledBy: s.by, createdAt: hoursAgo(s.ageH),
    };
    orders.push(o);
    if (reserved) for (const it of items) { const inv = inventory.find((i) => i.pharmacyId === s.ph && i.medicineId === it.medicineId); if (inv) inv.quantity = Math.max(0, inv.quantity - it.quantity); }
    payments.push({ id: `pay_${seq}`, orderId: id, userId: s.userId, method: s.pay, provider: s.pay === "COD" ? "COD" : "MOCK", amount: o.total, status: paymentStatus, providerRef: s.pay === "COD" ? undefined : `demo_${s.pay.toLowerCase()}_${seq}`, createdAt: o.createdAt });
    if (s.rider && ["RIDER_ASSIGNED", "PICKED_UP", "OUT_FOR_DELIVERY", "DELIVERED"].includes(s.status)) {
      const delivered = s.status === "DELIVERED";
      deliveries.push({
        id: `dl_${seq}`, orderId: id, partnerId: s.rider, status: delivered ? "DELIVERED" : s.status === "RIDER_ASSIGNED" ? "ASSIGNED" : "PICKED_UP",
        payout: type === "PRIORITY" ? settings.riderPayoutPriority : settings.riderPayoutNormal, cashToCollect: s.pay === "COD" ? o.total : 0,
        acceptedAt: hoursAgo(s.ageH / 2), pickedUpAt: s.status === "RIDER_ASSIGNED" ? undefined : hoursAgo(s.ageH / 3), deliveredAt: delivered ? hoursAgo(Math.max(0.3, s.ageH / 6)) : undefined,
      });
    }
    return o;
  }

  order({ userId: "u_1", fm: "fm_2", ph: "ph_1", ad: "ad_1", items: [[MED.METFORMIN, 3], [MED.TELMISARTAN, 1]], status: "DELIVERED", ageH: 24 * 30, pay: "UPI", rx: "rx_1", rider: "dp_1" }, "MC-48213");
  order({ userId: "u_1", ph: "ph_1", ad: "ad_1", items: [[MED.PARACETAMOL, 2], [MED.ORS, 1]], status: "OUT_FOR_DELIVERY", ageH: 1.2, pay: "COD", type: "PRIORITY", rider: "dp_1" }, "MC-51907");
  order({ userId: "u_2", fm: "fm_5", ph: "ph_1", ad: "ad_3", items: [[MED.AMLODIPINE, 2]], status: "PRESCRIPTION_REVIEW", ageH: 0.3, pay: "COD", rx: "rx_2" }, "MC-51921");
  order({ userId: "u_3", ph: "ph_2", ad: "ad_4", items: [[MED.CETIRIZINE, 1], [MED.VITAMIN_D, 1]], status: "PENDING", ageH: 0.15, pay: "COD" }, "MC-51925");
  order({ userId: "u_4", ph: "ph_1", ad: "ad_5", items: [[MED.CROCIN, 2], [MED.IBUPROFEN, 1]], status: "PREPARING", ageH: 0.6, pay: "COD" }, "MC-51918");
  order({ userId: "u_5", ph: "ph_2", ad: "ad_6", items: [[MED.PARACETAMOL, 1], [MED.ORS, 2]], status: "READY_FOR_PICKUP", ageH: 0.8, pay: "UPI", paid: true }, "MC-51915");
  order({ userId: "u_2", ph: "ph_1", ad: "ad_3", items: [[MED.PARACETAMOL, 2]], status: "DELIVERED", ageH: 72, pay: "COD", rider: "dp_2" }, "MC-51402");
  order({ userId: "u_3", ph: "ph_1", ad: "ad_4", items: [[MED.VITAMIN_D, 2], [MED.CETIRIZINE, 1]], status: "DELIVERED", ageH: 5, pay: "UPI", paid: true, rider: "dp_3" }, "MC-51890");
  order({ userId: "u_4", ph: "ph_1", ad: "ad_5", items: [[MED.IBUPROFEN, 2]], status: "CANCELLED", ageH: 30, pay: "UPI", paid: true, reason: "Ordered by mistake", by: "CUSTOMER" }, "MC-51512");
  order({ userId: "u_5", ph: "ph_1", ad: "ad_6", items: [[MED.CROCIN, 1]], status: "RIDER_ASSIGNED", ageH: 0.9, pay: "COD", rider: "dp_2" }, "MC-51914");
  order({ userId: "u_3", ph: "ph_1", ad: "ad_4", items: [[MED.PARACETAMOL, 1]], status: "CONFIRMED", ageH: 0.5, pay: "COD" }, "MC-51919");
  // Mark early delivered orders as already settled
  orders[0].settlementId = "set_1";
  orders[6].settlementId = "set_1";

  const prescriptions: T.Prescription[] = [
    { id: "rx_1", userId: "u_1", familyMemberId: "fm_2", fileKey: "rx_1.png", fileName: "prescription-march.png", mimeType: "image/png", sizeBytes: PNG_1PX.byteLength, status: "APPROVED", requestedMedicines: ["Metformin 500", "Telmisartan 40"], reviewedBy: "u_rx", pharmacyId: "ph_1", source: "UPLOAD", createdAt: hoursAgo(24 * 31) },
    { id: "rx_2", userId: "u_2", familyMemberId: "fm_5", fileKey: "rx_2.png", fileName: "bp-prescription.png", mimeType: "image/png", sizeBytes: PNG_1PX.byteLength, status: "UNDER_REVIEW", requestedMedicines: ["Amlodipine 5"], pharmacyId: "ph_1", source: "UPLOAD", createdAt: hoursAgo(0.3) },
    { id: "rx_3", userId: "guest:9811122233", fileKey: "rx_3.png", fileName: "photo.png", mimeType: "image/png", sizeBytes: PNG_1PX.byteLength, status: "RECEIVED", requestedMedicines: [], source: "QUICK_ORDER", callbackMobile: "9811122233", createdAt: hoursAgo(0.5) },
  ];
  const files = new Map<string, { bytes: Uint8Array; mimeType: string; ownerId: string }>();
  for (const p of prescriptions) files.set(p.fileKey, { bytes: PNG_1PX, mimeType: "image/png", ownerId: p.userId });

  const deliveryPartners: T.DeliveryPartner[] = [
    { id: "dp_1", userId: "u_dp1", name: "Sonu Yadav", mobile: "9822200001", vehicle: "Motorcycle UP34 •• 2041", verification: "VERIFIED", available: true, location: { lat: 27.57, lng: 80.686 }, joinedAt: hoursAgo(24 * 100) },
    { id: "dp_2", userId: "u_dp2", name: "Deepak Rawat", mobile: "9822200002", vehicle: "Scooter UP34 •• 8810", verification: "VERIFIED", available: true, location: { lat: 27.56, lng: 80.69 }, joinedAt: hoursAgo(24 * 80) },
    { id: "dp_3", userId: "u_dp3", name: "Imran Ali", mobile: "9822200003", vehicle: "Motorcycle UP34 •• 1177", verification: "VERIFIED", available: false, joinedAt: hoursAgo(24 * 60) },
    { id: "dp_4", userId: "u_dp4", name: "Vikas Pal", mobile: "9822200004", vehicle: "Scooter UP34 •• 5532", verification: "VERIFIED", available: true, location: { lat: 27.575, lng: 80.69 }, joinedAt: hoursAgo(24 * 40) },
    { id: "dp_5", userId: "u_dp5", name: "Ajay Tiwari", mobile: "9822200005", vehicle: "Bicycle", verification: "PENDING", available: false, joinedAt: hoursAgo(24 * 3) },
  ];

  const requests: T.MedicineRequest[] = [
    { id: "req_1", userId: "u_2", medicineQuery: "Liv-52 syrup", mobile: "9876500002", pincode: "261001", status: "OPEN", createdAt: hoursAgo(2) },
    { id: "req_2", userId: "u_3", medicineQuery: "Digene gel", mobile: "9876500003", pincode: "261121", status: "FOUND", createdAt: hoursAgo(20) },
  ];

  return {
    users, familyMembers, addresses, medicines, pharmacies, inventory, prescriptions, carts: [], orders, deliveryPartners, deliveries, payments,
    settlements: [
      { id: "set_1", partnerType: "PHARMACY", partnerId: "ph_1", periodStart: hoursAgo(24 * 37), periodEnd: hoursAgo(24 * 7), orderCount: 2, gross: orders[0].total + orders[6].total, commission: Math.round((orders[0].total + orders[6].total) * 0.08), net: Math.round((orders[0].total + orders[6].total) * 0.92), status: "PAID", createdAt: hoursAgo(24 * 7) },
      { id: "set_2", partnerType: "DELIVERY", partnerId: "dp_1", periodStart: hoursAgo(24 * 7), periodEnd: hoursAgo(0), orderCount: 1, gross: 45, commission: 0, net: 45, status: "PROCESSING", createdAt: hoursAgo(2) },
    ],
    medicineRequests: requests,
    medicineRequestResponses: [
      { id: "rr_1", requestId: "req_1", pharmacyId: "ph_2", response: "OUT_OF_STOCK", restockEta: "2 days", at: hoursAgo(1.5) },
      { id: "rr_2", requestId: "req_2", pharmacyId: "ph_3", response: "AVAILABLE", at: hoursAgo(18) },
    ],
    reviews: [{ id: "rv_1", userId: "u_1", pharmacyId: "ph_1", orderId: "ord_1", rating: 5, comment: "Medicines reached before evening.", createdAt: hoursAgo(24 * 29) }],
    notifications: [{ id: "n_1", userId: "u_1", event: "ORDER_CONFIRMED", channels: ["SMS", "PUSH"], title: "Order confirmed", body: "Your order MC-51907 is confirmed by Shree Ram Medical Store.", read: false, createdAt: hoursAgo(1) }],
    tickets: [
      { id: "tk_1", userId: "u_4", orderId: "ord_9", subject: "Refund not received", message: "I cancelled order MC-51512 yesterday but the refund has not reached my account.", status: "OPEN", createdAt: hoursAgo(6) },
      { id: "tk_2", userId: "u_2", subject: "Change of address", message: "How do I change the delivery address on a saved order?", status: "RESOLVED", createdAt: hoursAgo(48) },
    ],
    serviceAreas: [
      { id: "sa_1", level: "PINCODE", name: "261001", state: "Uttar Pradesh", district: "Sitapur", pincode: "261001", active: true, launchSignups: [] },
      { id: "sa_2", level: "PINCODE", name: "261121", state: "Uttar Pradesh", district: "Sitapur", pincode: "261121", active: true, launchSignups: [] },
      { id: "sa_3", level: "PINCODE", name: "261125", state: "Uttar Pradesh", district: "Sitapur", pincode: "261125", active: true, launchSignups: [] },
    ],
    savedMedicines: [
      { id: "sv_1", userId: "u_1", familyMemberId: "fm_2", label: "Diabetes & Blood Pressure", items: [{ medicineId: MED.METFORMIN, quantity: 3 }, { medicineId: MED.TELMISARTAN, quantity: 1 }], everyDays: 30, nextRefillAt: daysAhead(4), reminderOn: true, preferredPharmacyId: "ph_1" },
      { id: "sv_2", userId: "u_1", familyMemberId: "fm_3", label: "Thyroid", items: [{ medicineId: MED.THYRONORM, quantity: 1 }], everyDays: 60, nextRefillAt: daysAhead(21), reminderOn: true, preferredPharmacyId: "ph_2" },
    ],
    offers: [
      { id: "off_1", title: "First order: 10% off", description: "On your first medicine order, up to ₹75.", code: "FIRST10", percentOff: 10, maxDiscount: 75, minOrder: 200, active: true },
      { id: "off_2", title: "Free delivery above ₹499", description: "Applied automatically on normal delivery.", code: "FREEDEL", percentOff: 0, maxDiscount: 0, minOrder: 499, active: true },
    ],
    settings: [settings],
    audit: [],
    files,
  };
}
