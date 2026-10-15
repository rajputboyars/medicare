import { beforeEach, describe, expect, it, vi } from "vitest";
import { rateLimiter } from "@/lib/rate-limit";
import { MED } from "@/server/seed";
import { db, resetDb } from "@/server/store";
import { devOutbox } from "@/server/features/auth/otp-provider";
import { call, jar, route, signIn, type Reply } from "./helpers/http";
import { en } from "@/i18n/en";
import { hi } from "@/i18n/hi";
import { LANGUAGES, translate, type Key } from "@/i18n";

vi.mock("next/headers", async () => await import("./helpers/next-headers"));

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

beforeEach(() => { resetDb(); rateLimiter.reset?.(); devOutbox.clear(); jar.token = undefined; jar.headers = {}; vi.useRealTimers(); });

// ───────────── helpers: drive the real endpoints ─────────────

async function startApplicant(mobile: string, name: string, type: "PHARMACY" | "RIDER") {
  const rq = await call((await route("auth/otp/request")).POST, "POST", "/x", { body: { mobile } });
  const v = await call((await route("auth/otp/verify")).POST, "POST", "/x", { body: { challengeId: rq.body.data.challengeId, code: devOutbox.last(mobile)! } });
  expect(v.body.data.isNewUser).toBe(true);
  const r = await call((await route("partner/start")).POST, "POST", "/api/partner/start", { body: { signupToken: v.body.data.signupToken, name, type } });
  expect(r.status).toBe(201);
  jar.token = /mc_session=([^;]+)/.exec(r.headers.get("set-cookie") ?? "")![1];
  return r;
}
const save = async (step: string, data: Record<string, unknown>) => call((await route("partner/application")).PATCH, "PATCH", "/api/partner/application", { body: { step, data } });
const getApp = async () => (await call((await route("partner/application")).GET, "GET", "/x")).body.data;
async function upload(kind: string, label?: string, bytes: Uint8Array = PNG, type = "image/png"): Promise<Reply> {
  const form = new FormData();
  form.set("kind", kind); if (label) form.set("label", label);
  form.set("file", new File([bytes as BlobPart], "doc.png", { type }));
  const res = await (await route("partner/application/documents")).POST(new Request("http://localhost/api/partner/application/documents", { method: "POST", body: form }), { params: Promise.resolve({}) });
  return { status: res.status, body: await res.json(), headers: res.headers };
}

const PHARMACY = {
  owner: { ownerName: "Sita Rani", email: "sita@example.com" },
  store: { storeName: "Rani Medical Hall", storeType: "RETAIL" },
  address: { address: "Station Road, Biswan", area: "Station Road", town: "Biswan", district: "Sitapur", state: "Uttar Pradesh", pincode: "261125", landmark: "Next to the bus stand" },
  license: { drugLicenseNumber: "UP-SIT-26-1234", validTill: "2031-01-01", issuingState: "Uttar Pradesh", gstin: "" },
  pharmacist: { pharmacistName: "Rohit Verma", registrationNumber: "UPPC-55555", pharmacistMobile: "9811100088" },
  delivery: { servicePincodes: ["261125"], radiusKm: 6, openTime: "09:00", closeTime: "21:00", priorityDelivery: false, avgPrepMinutes: 15 },
  inventory: { plan: "CSV_AFTER_APPROVAL" },
};
const RIDER = {
  personal: { fullName: "Kamal Singh", dateOfBirth: "1998-04-02", emergencyContactName: "Rita Singh", emergencyContactMobile: "9811100077" },
  address: { address: "Ward 3, Biswan", town: "Biswan", district: "Sitapur", state: "Uttar Pradesh", pincode: "261125" },
  serviceArea: { servicePincodes: ["261125"] },
  vehicle: { vehicleType: "MOTORCYCLE", vehicleNumber: "UP34AB1234", licenseNumber: "DL-0420110012345" },
  payment: { method: "UPI", upiId: "kamal@okbank" },
};
const PHARMACY_DOCS = ["DRUG_LICENSE", "SHOP_IMAGE", "PHARMACIST_CERTIFICATE"];
const RIDER_DOCS = ["ID_PROOF", "PROFILE_PHOTO", "DRIVING_LICENSE", "VEHICLE_RC"];

async function fillApplication(answers: Record<string, Record<string, unknown>>, docs: string[]) {
  for (const [step, data] of Object.entries(answers)) expect((await save(step, data)).status, step).toBe(200);
  for (const k of docs) expect((await upload(k)).status, k).toBe(201);
}
const submit = async (consent = true) => call((await route("partner/application/submit")).POST, "POST", "/x", { body: { consent } });

/** Admin processes an application end to end through the real endpoints. */
async function adminDecide(id: string, action: "APPROVE" | "REJECT" | "REQUEST_INFO", note?: string, approveDocs = true) {
  await signIn("admin@example.com");
  await call((await route("admin/applications/[id]/review")).POST, "POST", "/x", { params: { id }, body: { action: "START_REVIEW" } });
  if (approveDocs) {
    const detail = (await call((await route("admin/applications/[id]")).GET, "GET", "/x", { params: { id } })).body.data;
    for (const d of detail.documents) await call((await route("admin/applications/[id]/documents/[docId]")).POST, "POST", "/x", { params: { id, docId: d.id }, body: { status: "APPROVED" } });
  }
  return call((await route("admin/applications/[id]/review")).POST, "POST", "/x", { params: { id }, body: { action, note } });
}
const appId = (mobile: string) => db().partnerApplications.find((a) => db().users.find((u) => u.id === a.userId)?.mobile === mobile)!.id;

// ───────────── Pharmacy onboarding ─────────────

describe("pharmacy onboarding: start, autosave, resume, progress", () => {
  it("a verified mobile becomes a DRAFT applicant with NO pharmacy and NO selling permission", async () => {
    await startApplicant("9000011001", "Sita Rani", "PHARMACY");
    const u = db().users.find((x) => x.mobile === "9000011001")!;
    expect(u.role).toBe("PHARMACY_ADMIN");
    expect(u.partnerId).toBeUndefined();
    expect(u.passwordHash).toBeUndefined();
    expect(db().pharmacies.some((p) => p.mobile === "9000011001")).toBe(false);
    const app = await getApp();
    expect(app).toMatchObject({ type: "PHARMACY", status: "DRAFT", progress: { editable: true, canSubmit: false } });
    expect(app.progress.percent).toBeLessThan(20); // only the owner's name is pre-filled
    expect(app.steps.map((s: { key: string }) => s.key)).toEqual(["owner", "store", "address", "license", "documents", "pharmacist", "delivery", "inventory", "review"]);
    expect(db().analytics.some((e) => e.name === "pharmacy_registration_started")).toBe(true);
  });
  it("autosaves partial answers, checks formats, tracks progress, and keeps what was saved", async () => {
    await startApplicant("9000011001", "Sita Rani", "PHARMACY");
    expect((await save("store", { storeName: "Rani Medical" })).status).toBe(200);      // partial is fine
    expect((await save("address", { pincode: "12" })).status).toBe(400);                 // formats still checked
    expect((await save("address", { surprise: "x" })).status).toBe(400);                // unknown fields refused
    expect((await save("nonsense", {})).status).toBe(400);
    await save("owner", PHARMACY.owner); await save("store", PHARMACY.store);
    const app = await getApp();
    expect(app.data.store).toEqual(PHARMACY.store);
    expect(app.progress.steps.find((s: { key: string }) => s.key === "store").complete).toBe(true);
    expect(app.progress.steps.find((s: { key: string }) => s.key === "address").issues).toBeTruthy();
    expect(app.progress.percent).toBeGreaterThan(0);
    expect(app.progress.nextStep).toBe("address");
  });
  it("a returning applicant signs in with their mobile and continues where they stopped", async () => {
    await startApplicant("9000011001", "Sita Rani", "PHARMACY");
    await save("owner", PHARMACY.owner); await save("store", PHARMACY.store);
    jar.token = undefined; devOutbox.clear(); vi.useFakeTimers({ now: Date.now() + 60_000 });
    const rq = await call((await route("auth/otp/request")).POST, "POST", "/x", { body: { mobile: "9000011001" } });
    const v = await call((await route("auth/otp/verify")).POST, "POST", "/x", { body: { challengeId: rq.body.data.challengeId, code: devOutbox.last("9000011001")! } });
    expect(v.body.data).toMatchObject({ isNewUser: false, user: { role: "PHARMACY_ADMIN" }, redirect: "/pharmacy" });
    jar.token = /mc_session=([^;]+)/.exec(v.headers.get("set-cookie") ?? "")![1];
    const app = await getApp();
    expect(app.data.store.storeName).toBe("Rani Medical Hall");
    expect(app.step).toBeGreaterThanOrEqual(2);
    expect(app.progress.nextStep).toBe("address");
  });
  it("a mobile that already has an account cannot start a second one", async () => {
    const rq = await call((await route("auth/otp/request")).POST, "POST", "/x", { body: { mobile: "9876543210" } });
    const v = await call((await route("auth/otp/verify")).POST, "POST", "/x", { body: { challengeId: rq.body.data.challengeId, code: devOutbox.last("9876543210")! } });
    expect(v.body.data.isNewUser).toBe(false); // existing customer: no signup token at all
    expect((await call((await route("partner/start")).POST, "POST", "/x", { body: { signupToken: "x".repeat(40), name: "Ab", type: "PHARMACY" } })).status).toBe(401);
  });
  it("licence rules: an expired licence or a bad GSTIN is caught", async () => {
    await startApplicant("9000011001", "Sita Rani", "PHARMACY");
    const expired = await save("license", { drugLicenseNumber: "UP-SIT-26-1234", validTill: "2020-01-01", issuingState: "Uttar Pradesh" });
    expect(expired.status).toBe(400);
    expect(expired.body.errors?.[0]).toMatchObject({ field: "validTill", message: "The licence must still be valid" });
    expect((await save("license", { gstin: "short" })).status).toBe(400);
    expect((await save("license", { drugLicenseNumber: "UP-SIT-26-1234", validTill: "2031-01-01" })).status).toBe(200); // partial is fine
    expect((await getApp()).progress.steps.find((s: { key: string }) => s.key === "license").complete).toBe(false); // issuing state missing
  });
});

describe("pharmacy documents: secure storage and access", () => {
  it("accepts images and PDFs, refuses anything else, and never returns the storage key", async () => {
    await startApplicant("9000011001", "Sita Rani", "PHARMACY");
    const ok = await upload("DRUG_LICENSE");
    expect(ok.status).toBe(201);
    expect(JSON.stringify(ok.body)).not.toMatch(/fileKey|doc_[a-z0-9]+\.png/);
    expect(ok.body.data.document).toMatchObject({ kind: "DRUG_LICENSE", status: "UPLOADED", mimeType: "image/png" });
    expect((await upload("DRUG_LICENSE", undefined, new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]), "image/png")).status).toBe(400);              // not really a PNG
    expect((await upload("DRUG_LICENSE", undefined, new Uint8Array([0x4d, 0x5a, 0, 0, 0, 0, 0, 0]), "application/x-msdownload")).status).toBe(400); // executable
    expect((await upload("ID_PROOF")).status).toBe(400);   // a rider document is not needed here
    expect((await upload("NOT_A_KIND")).status).toBe(400);
  });
  it("a new file replaces the old one of the same kind; 'other' documents can be several", async () => {
    await startApplicant("9000011001", "Sita Rani", "PHARMACY");
    await upload("DRUG_LICENSE"); await upload("DRUG_LICENSE");
    const mine = () => db().partnerDocuments.filter((d) => d.uploadedBy === db().users.find((u) => u.mobile === "9000011001")!.id);
    expect(mine().filter((d) => d.kind === "DRUG_LICENSE")).toHaveLength(1);
    const before = db().files.size;
    await upload("DRUG_LICENSE");
    expect(db().files.size).toBe(before); // the replaced file was deleted from storage, not orphaned
    await upload("OTHER_BUSINESS", "Trade licence"); await upload("OTHER_BUSINESS", "Lease");
    expect(mine().filter((d) => d.kind === "OTHER_BUSINESS")).toHaveLength(2);
  });
  it("only the applicant and platform admins can open a document: not another applicant, a pharmacy, a rider or a customer", async () => {
    await startApplicant("9000011001", "Sita Rani", "PHARMACY");
    const up = await upload("DRUG_LICENSE");
    const id = up.body.data.document.id;
    const view = async (who: string | undefined) => { await signIn(who); return call((await route("partner/application/documents/[id]")).GET, "GET", "/x", { params: { id } }); };
    const link = async (who: string) => (await view(who)).body.data.url as string;
    const owner = db().users.find((u) => u.mobile === "9000011001")!;
    jar.token = (await signIn(owner.mobile))?.token;
    const mine = await call((await route("partner/application/documents/[id]")).GET, "GET", "/x", { params: { id } });
    expect(mine.status).toBe(200);
    expect(mine.body.data.url).toMatch(/^\/api\/files\/.+sig=/);
    expect(JSON.stringify(mine.body)).not.toMatch(/fileKey/);
    expect((await view("admin@example.com")).status).toBe(200);
    for (const who of ["asha@example.com", "pharmacy@example.com", "pharmacist@example.com", "rider@example.com", undefined]) expect((await view(who)).status, String(who)).toBe(who ? 403 : 401);
    expect(db().audit.some((a) => a.action === "PARTNER_DOCUMENT_VIEWED")).toBe(true);
    // the signed link itself works only for the person it was issued to
    const url = await link("admin@example.com");
    const key = url.split("/api/files/")[1].split("?")[0];
    const files = (await route("files/[key]")).GET;
    const open = async (u: string) => (await files(new Request("http://localhost" + u), { params: Promise.resolve({ key }) })).status;
    await signIn("admin@example.com");
    expect(await open(url)).toBe(200);
    await signIn("pharmacy@example.com");
    expect(await open(url)).toBe(403);
    await signIn(undefined);
    expect(await open(url)).toBe(403);
  });
  it("an applicant cannot read another applicant's application or documents", async () => {
    await startApplicant("9000011001", "Sita Rani", "PHARMACY");
    const up = await upload("DRUG_LICENSE");
    const id = up.body.data.document.id;
    jar.token = undefined; devOutbox.clear(); vi.useFakeTimers({ now: Date.now() + 60_000 });
    await startApplicant("9000011002", "Other Owner", "PHARMACY");
    expect((await getApp()).data.store).toBeUndefined();
    expect((await call((await route("partner/application/documents/[id]")).GET, "GET", "/x", { params: { id } })).status).toBe(403);
    expect((await call((await route("partner/application/documents/[id]")).DELETE, "DELETE", "/x", { params: { id } })).status).toBe(404); // does not even confirm it exists
    expect(db().partnerDocuments.some((d) => d.id === id)).toBe(true);
  });
});

describe("pharmacy submission and admin review", () => {
  async function submitted() {
    await startApplicant("9000011001", "Sita Rani", "PHARMACY");
    await fillApplication(PHARMACY, PHARMACY_DOCS);
    expect((await getApp()).progress).toMatchObject({ percent: 100, canSubmit: true });
    return submit();
  }
  it("cannot be submitted until every step and every required document is done, and consent is given", async () => {
    await startApplicant("9000011001", "Sita Rani", "PHARMACY");
    const early = await submit();
    expect(early.status).toBe(400);
    expect(early.body.message).toMatch(/Please finish/);
    await fillApplication(PHARMACY, PHARMACY_DOCS.slice(0, 2)); // missing the pharmacist certificate
    expect((await submit()).body.message).toMatch(/Documents/);
    await upload("PHARMACIST_CERTIFICATE");
    expect((await submit(false)).status).toBe(400);
    expect((await submit()).status).toBe(200);
  });
  it("after submitting: status SUBMITTED, the applicant can no longer edit, and still has no pharmacy", async () => {
    const r = await submitted();
    expect(r.body.data.status).toBe("SUBMITTED");
    expect((await save("store", { storeName: "Changed After" })).status).toBe(409);
    expect((await upload("SHOP_IMAGE")).status).toBe(409);
    expect(db().pharmacies.some((p) => p.mobile === "9000011001")).toBe(false);
    expect(db().analytics.some((e) => e.name === "pharmacy_application_submitted")).toBe(true);
  });
  it("RESTRICTION: until APPROVED the applicant cannot sell, manage stock, see orders, or switch ordering on", async () => {
    await submitted();
    const blocked: [string, string, unknown?][] = [
      ["pharmacy/orders", "GET"], ["pharmacy/inventory", "GET"], ["pharmacy/inventory", "POST", { medicineId: MED.PARACETAMOL, batch: "B1", expiry: "2030-01-01", mrp: 30, sellingPrice: 28, stockQuantity: 5 }],
      ["pharmacy/settings", "PATCH", { acceptingOrders: true }], ["pharmacy/dashboard", "GET"], ["pharmacy/medicine-requests", "GET"], ["pharmacy/onboarding", "GET"],
      ["pharmacy/assisted-orders/consent", "POST", { mobile: "9876543210" }],
    ];
    for (const [path, method, body] of blocked) expect((await call((await route(path))[method], method, `/api/${path}`, { body })).status, path).toBe(403);
    // and not through the customer-facing side either
    expect(db().pharmacies.filter((p) => p.mobile === "9000011001")).toHaveLength(0);
  });
  it("a SUBMITTED application cannot be approved directly: review must start first", async () => {
    await submitted();
    const id = appId("9000011001");
    await signIn("admin@example.com");
    const r = await call((await route("admin/applications/[id]/review")).POST, "POST", "/x", { params: { id }, body: { action: "APPROVE" } });
    expect(r.status).toBe(400); // nothing has been checked yet
    expect(r.body.message).toMatch(/Approve these documents first/);
    expect(db().pharmacies.some((p) => p.mobile === "9000011001")).toBe(false);
  });
  it("approval needs every required document approved first", async () => {
    await submitted();
    const id = appId("9000011001");
    const r = await adminDecide(id, "APPROVE", undefined, false);
    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(/Approve these documents first/);
    expect(db().partnerApplications.find((a) => a.id === id)!.status).toBe("UNDER_REVIEW");
  });
  it("APPROVE creates the pharmacy (verified, but NOT accepting orders), links the account and notifies the owner", async () => {
    await submitted();
    const id = appId("9000011001");
    const r = await adminDecide(id, "APPROVE", "Looks good");
    expect(r.status).toBe(200);
    const app = db().partnerApplications.find((a) => a.id === id)!;
    expect(app).toMatchObject({ status: "APPROVED", decidedBy: "u_ad" });
    const ph = db().pharmacies.find((p) => p.id === app.partnerId)!;
    expect(ph).toMatchObject({ name: "Rani Medical Hall", drugLicense: "UP-SIT-26-1234", verification: "VERIFIED", acceptingOrders: false, servicePincodes: ["261125"], mobile: "9000011001" });
    expect(db().users.find((u) => u.mobile === "9000011001")!.partnerId).toBe(ph.id);
    expect(db().notifications.some((n) => n.event === "APPLICATION_UPDATE" && n.title === "You are approved")).toBe(true);
    expect(db().analytics.some((e) => e.name === "pharmacy_approved")).toBe(true);
    expect(db().audit.some((a) => a.action === "APPLICATION_APPROVED" && a.actorId === "u_ad" && a.targetId === id)).toBe(true);
    // customers still cannot buy from it until it switches ordering on
    expect(db().pharmacies.find((p) => p.id === ph.id)!.acceptingOrders).toBe(false);
  });
  it("after approval the owner has pharmacy access, but cannot accept orders until stock exists", async () => {
    await submitted();
    await adminDecide(appId("9000011001"), "APPROVE");
    await signIn("9000011001");
    expect((await call((await route("pharmacy/orders")).GET, "GET", "/x")).status).toBe(200);
    const on = await call((await route("pharmacy/settings")).PATCH, "PATCH", "/x", { body: { acceptingOrders: true } });
    expect(on.status).toBe(409);
    expect(on.body.message).toMatch(/Add your medicines first/);
    const add = await call((await route("pharmacy/inventory")).POST, "POST", "/x", { body: { medicineId: MED.PARACETAMOL, batch: "B1", expiry: "2030-01-01", mrp: 30, sellingPrice: 28, stockQuantity: 20 } });
    expect(add.status).toBe(201);
    expect(db().analytics.some((e) => e.name === "inventory_added")).toBe(true);
    expect((await call((await route("pharmacy/settings")).PATCH, "PATCH", "/x", { body: { acceptingOrders: true } })).status).toBe(200);
  });
  it("REJECT needs a reason the applicant can read; the applicant never gets a pharmacy", async () => {
    await submitted();
    const id = appId("9000011001");
    expect((await adminDecide(id, "REJECT", "")).status).toBe(400);
    expect((await adminDecide(id, "REJECT", "The licence photo is for a different shop")).status).toBe(200);
    expect(db().pharmacies.some((p) => p.mobile === "9000011001")).toBe(false);
    await signIn("9000011001");
    const view = await getApp();
    expect(view.status).toBe("REJECTED");
    expect(view.events.at(-1)).toMatchObject({ type: "REJECTED", note: "The licence photo is for a different shop" });
    expect((await call((await route("pharmacy/orders")).GET, "GET", "/x")).status).toBe(403);
  });
  it("MORE_INFO_REQUIRED: the applicant fixes a flagged document, resubmits, and is approved", async () => {
    await submitted();
    const id = appId("9000011001");
    await signIn("admin@example.com");
    const review = (await route("admin/applications/[id]/review")).POST;
    const docRoute = (await route("admin/applications/[id]/documents/[docId]")).POST;
    await call(review, "POST", "/x", { params: { id }, body: { action: "START_REVIEW" } });
    const lic = db().partnerDocuments.find((d) => d.applicationId === id && d.kind === "DRUG_LICENSE")!;
    expect((await call(docRoute, "POST", "/x", { params: { id, docId: lic.id }, body: { status: "REUPLOAD_REQUESTED" } })).status).toBe(400); // needs a note
    expect((await call(docRoute, "POST", "/x", { params: { id, docId: lic.id }, body: { status: "REUPLOAD_REQUESTED", note: "The photo is blurry. Please upload a clearer one." } })).status).toBe(200);
    expect((await call(review, "POST", "/x", { params: { id }, body: { action: "REQUEST_INFO", note: "Please send a clearer licence photo" } })).status).toBe(200);
    // applicant side
    await signIn("9000011001");
    let app = await getApp();
    expect(app).toMatchObject({ status: "MORE_INFO_REQUIRED", progress: { editable: true } });
    expect(app.documents.find((d: { kind: string }) => d.kind === "DRUG_LICENSE")).toMatchObject({ status: "REUPLOAD_REQUESTED", reviewNote: "The photo is blurry. Please upload a clearer one." });
    expect((await submit()).status).toBe(400);                  // cannot resubmit without replacing it
    expect((await upload("DRUG_LICENSE")).status).toBe(201);    // the replacement
    expect((await submit()).status).toBe(200);
    app = await getApp();
    expect(app.status).toBe("SUBMITTED");
    // admin approves the other documents again, the new one too
    expect((await adminDecide(id, "APPROVE")).status).toBe(200);
  });
  it("internal notes are visible to admins only; the history records every action", async () => {
    await submitted();
    const id = appId("9000011001");
    await signIn("admin@example.com");
    const review = (await route("admin/applications/[id]/review")).POST;
    expect((await call(review, "POST", "/x", { params: { id }, body: { action: "NOTE", note: "" } })).status).toBe(400);
    await call(review, "POST", "/x", { params: { id }, body: { action: "NOTE", note: "Owner sounded unsure on the phone. Double-check the shop photo." } });
    await call(review, "POST", "/x", { params: { id }, body: { action: "START_REVIEW" } });
    const detail = (await call((await route("admin/applications/[id]")).GET, "GET", "/x", { params: { id } })).body.data;
    expect(detail.events.map((e: { type: string }) => e.type)).toEqual(["STARTED", "DOCUMENT_UPLOADED", "DOCUMENT_UPLOADED", "DOCUMENT_UPLOADED", "SUBMITTED", "NOTE", "REVIEW_STARTED"]);
    expect(detail.events.find((e: { type: string }) => e.type === "NOTE")).toMatchObject({ internal: true, actorRole: "SUPER_ADMIN" });
    await signIn("9000011001");
    const mine = JSON.stringify(await getApp());
    expect(mine).not.toMatch(/Owner sounded unsure|internal|u_ad/);
  });
  it("the admin list is paginated, filterable and shows what needs checking", async () => {
    await submitted();
    await signIn("admin@example.com");
    const list = await call((await route("admin/applications")).GET, "GET", "/api/admin/applications?status=SUBMITTED&type=PHARMACY");
    expect(list.body.meta.total).toBeGreaterThanOrEqual(2); // the seeded one + this one
    expect(list.body.data.every((a: { status: string; type: string }) => a.status === "SUBMITTED" && a.type === "PHARMACY")).toBe(true);
    const mine = list.body.data.find((a: { mobile: string }) => a.mobile === "9000011001");
    expect(mine).toMatchObject({ documents: 3, documentsToCheck: 3, percent: 100 });
    const seeded = await call((await route("admin/applications")).GET, "GET", "/api/admin/applications?q=Sanjeevani");
    expect(seeded.body.data).toHaveLength(1);
  });
  it("suspending an approved pharmacy stops selling at once and signs the owner out; reinstating restores it", async () => {
    await submitted();
    const id = appId("9000011001");
    await adminDecide(id, "APPROVE");
    const ph = () => db().pharmacies.find((p) => p.mobile === "9000011001")!;
    ph().acceptingOrders = true;
    const owner = await signIn("9000011001");
    expect((await call((await route("pharmacy/orders")).GET, "GET", "/x")).status).toBe(200);
    await signIn("admin@example.com");
    const review = (await route("admin/applications/[id]/review")).POST;
    expect((await call(review, "POST", "/x", { params: { id }, body: { action: "SUSPEND", note: "" } })).status).toBe(400);
    expect((await call(review, "POST", "/x", { params: { id }, body: { action: "SUSPEND", note: "Customer complaints under investigation" } })).status).toBe(200);
    expect(ph()).toMatchObject({ verification: "SUSPENDED", acceptingOrders: false });
    jar.token = owner!.token;
    expect((await call((await route("pharmacy/orders")).GET, "GET", "/x")).status).toBe(401); // sessions revoked
    await signIn("admin@example.com");
    expect((await call(review, "POST", "/x", { params: { id }, body: { action: "REINSTATE" } })).status).toBe(200);
    expect(ph().verification).toBe("VERIFIED");
    await signIn("9000011001");
    expect((await call((await route("pharmacy/orders")).GET, "GET", "/x")).status).toBe(200);
  });
  it("a suspended pharmacy cannot work existing orders either", async () => {
    await signIn("pharmacy@example.com");
    db().pharmacies.find((p) => p.id === "ph_1")!.verification = "SUSPENDED";
    const r = await call((await route("pharmacy/orders/[id]/approve")).POST, "POST", "/x", { params: { id: db().orders.find((o) => o.pharmacyId === "ph_1" && o.status === "PENDING")?.id ?? "ord_4" }, body: {} });
    expect(r.status).toBe(403);
  });
});

describe("setup checklist after approval", () => {
  async function approvedOwner() {
    await startApplicant("9000011001", "Sita Rani", "PHARMACY");
    await fillApplication(PHARMACY, PHARMACY_DOCS);
    await submit();
    await adminDecide(appId("9000011001"), "APPROVE");
    await signIn("9000011001");
  }
  it("starts at 40% (verified + delivery settings) and rises as the owner completes each item", async () => {
    await approvedOwner();
    const get = async () => (await call((await route("pharmacy/onboarding")).GET, "GET", "/x")).body.data;
    let c = await get();
    expect(c.items.map((i: { key: string; done: boolean }) => [i.key, i.done])).toEqual([["verified", true], ["inventory", false], ["delivery", true], ["bank", false], ["training", false]]);
    expect(c.percent).toBe(40);
    await call((await route("pharmacy/inventory")).POST, "POST", "/x", { body: { medicineId: MED.PARACETAMOL, batch: "B1", expiry: "2030-01-01", mrp: 30, sellingPrice: 28, stockQuantity: 20 } });
    expect((await get()).percent).toBe(60);
    const bank = await call((await route("pharmacy/onboarding/settlement")).POST, "POST", "/x", { body: { holderName: "Sita Rani", accountNumber: "123456789012", ifsc: "SBIN0001234" } });
    expect(bank.status).toBe(200);
    expect(JSON.stringify(bank.body)).not.toContain("123456789012");
    expect((await get()).percent).toBe(80);
    await call((await route("pharmacy/onboarding/training")).POST, "POST", "/x");
    c = await get();
    expect(c).toMatchObject({ percent: 100, complete: true });
  });
  it("the walkthrough is shown once", async () => {
    await approvedOwner();
    const get = async () => (await call((await route("pharmacy/onboarding")).GET, "GET", "/x")).body.data;
    expect((await get()).walkthroughSeen).toBe(false);
    await call((await route("pharmacy/onboarding/walkthrough")).POST, "POST", "/x");
    expect((await get()).walkthroughSeen).toBe(true);
  });
  it("bank details: validated, owner-only, and the number never comes back out of any endpoint", async () => {
    await approvedOwner();
    const bank = (await route("pharmacy/onboarding/settlement")).POST;
    expect((await call(bank, "POST", "/x", { body: { holderName: "Sita", accountNumber: "12", ifsc: "BAD" } })).status).toBe(400);
    expect((await call(bank, "POST", "/x", { body: { holderName: "Sita Rani" } })).status).toBe(400);
    expect((await call(bank, "POST", "/x", { body: { holderName: "Sita Rani", accountNumber: "123456789012", ifsc: "SBIN0001234" } })).status).toBe(200);
    const settings = await call((await route("pharmacy/settings")).GET, "GET", "/x");
    expect(JSON.stringify(settings.body)).not.toContain("123456789012");
    expect(settings.body.data.onboarding.settlement).toMatchObject({ holderName: "Sita Rani", accountLast4: "9012" });
    expect(JSON.stringify(db().audit)).not.toContain("123456789012");
    // a pharmacist (staff, not owner) cannot set payout details
    await signIn("pharmacist@example.com");
    expect((await call(bank, "POST", "/x", { body: { holderName: "Kavita", upiId: "kavita@okbank" } })).status).toBe(403);
  });
});

// ───────────── Rider onboarding ─────────────

describe("rider onboarding", () => {
  it("mobile → OTP → application; the rider has NO delivery profile and cannot accept orders", async () => {
    await startApplicant("9000022001", "Kamal Singh", "RIDER");
    const u = db().users.find((x) => x.mobile === "9000022001")!;
    expect(u).toMatchObject({ role: "DELIVERY_PARTNER" });
    expect(u.partnerId).toBeUndefined();
    const app = await getApp();
    expect(app.steps.map((s: { key: string }) => s.key)).toEqual(["personal", "address", "serviceArea", "vehicle", "documents", "payment", "review"]);
    for (const [path, method] of [["rider/deliveries/available", "GET"], ["delivery/me", "GET"], ["delivery/active", "GET"]] as const) expect((await call((await route(path))[method], method, "/x")).status, path).toBe(403);
    expect(db().analytics.some((e) => e.name === "rider_registration_started")).toBe(true);
  });
  it("vehicle rules: a bicycle needs no licence or RC, a motorcycle needs both", async () => {
    await startApplicant("9000022001", "Kamal Singh", "RIDER");
    await save("personal", RIDER.personal); await save("address", RIDER.address); await save("serviceArea", RIDER.serviceArea); await save("payment", RIDER.payment);
    await save("vehicle", { vehicleType: "MOTORCYCLE" });
    let app = await getApp();
    expect(app.progress.steps.find((s: { key: string }) => s.key === "vehicle").complete).toBe(false);
    await save("vehicle", { vehicleType: "BICYCLE" });
    await upload("ID_PROOF"); await upload("PROFILE_PHOTO");
    app = await getApp();
    expect(app.progress.steps.find((s: { key: string }) => s.key === "vehicle").complete).toBe(true);
    expect(app.progress.steps.find((s: { key: string }) => s.key === "documents").complete).toBe(true); // licence/RC not needed for a bicycle
    expect((await getApp()).documentRules.find((r: { kind: string }) => r.kind === "DRIVING_LICENSE").required).toBe(false);
  });
  it("must be 18+, with valid payment details", async () => {
    await startApplicant("9000022001", "Kamal Singh", "RIDER");
    const young = await save("personal", { ...RIDER.personal, dateOfBirth: new Date(Date.now() - 16 * 365 * 86400_000).toISOString().slice(0, 10) });
    expect(young.status).toBe(400);
    expect(young.body.errors?.[0]).toMatchObject({ field: "dateOfBirth", message: "You must be at least 18 years old" });
    await save("payment", { method: "UPI", upiId: "not-a-upi" });
    expect((await getApp()).progress.steps.find((s: { key: string }) => s.key === "payment").issues.upiId).toMatch(/UPI/); // saved as a draft, flagged at submit
    await save("payment", { method: "BANK", accountHolder: "Kamal", accountNumber: "1234", ifsc: "X" });
    expect((await getApp()).progress.steps.find((s: { key: string }) => s.key === "payment").complete).toBe(false);
  });
  async function approvedRider() {
    await startApplicant("9000022001", "Kamal Singh", "RIDER");
    await fillApplication(RIDER, RIDER_DOCS);
    expect((await submit()).status).toBe(200);
    expect((await adminDecide(appId("9000022001"), "APPROVE")).status).toBe(200);
  }
  it("RESTRICTION: submitted is not enough; only APPROVED creates the delivery profile", async () => {
    await startApplicant("9000022001", "Kamal Singh", "RIDER");
    await fillApplication(RIDER, RIDER_DOCS);
    await submit();
    expect(db().deliveryPartners.some((p) => p.mobile === "9000022001")).toBe(false);
    await signIn("9000022001");
    expect((await call((await route("rider/deliveries/available")).GET, "GET", "/x")).status).toBe(403);
    expect(db().analytics.some((e) => e.name === "rider_application_submitted")).toBe(true);
  });
  it("after approval the rider gets a VERIFIED profile, starts OFFLINE, and can go online", async () => {
    await approvedRider();
    const dp = db().deliveryPartners.find((p) => p.mobile === "9000022001")!;
    expect(dp).toMatchObject({ verification: "VERIFIED", available: false, name: "Kamal Singh" });
    await signIn("9000022001");
    expect((await call((await route("delivery/me")).GET, "GET", "/x")).body.data).toMatchObject({ status: "OFFLINE", verification: "VERIFIED" });
    expect((await call((await route("delivery/me")).PATCH, "PATCH", "/x", { body: { available: true } })).status).toBe(200);
    expect((await call((await route("rider/deliveries/available")).GET, "GET", "/x")).status).toBe(200);
  });
  it("a suspended rider cannot go online or accept, and their devices are signed out", async () => {
    await approvedRider();
    const id = appId("9000022001");
    const rider = await signIn("9000022001");
    await call((await route("delivery/me")).PATCH, "PATCH", "/x", { body: { available: true } });
    await signIn("admin@example.com");
    expect((await call((await route("admin/applications/[id]/review")).POST, "POST", "/x", { params: { id }, body: { action: "SUSPEND", note: "Safety complaint" } })).status).toBe(200);
    const dp = db().deliveryPartners.find((p) => p.mobile === "9000022001")!;
    expect(dp).toMatchObject({ verification: "SUSPENDED", available: false });
    jar.token = rider!.token;
    expect((await call((await route("rider/deliveries/available")).GET, "GET", "/x")).status).toBe(401);
  });
  it("a rider application is rejected with a reason, and a rejected rider stays out", async () => {
    await startApplicant("9000022001", "Kamal Singh", "RIDER");
    await fillApplication(RIDER, RIDER_DOCS);
    await submit();
    expect((await adminDecide(appId("9000022001"), "REJECT", "The ID photo does not match the name")).status).toBe(200);
    expect(db().deliveryPartners.some((p) => p.mobile === "9000022001")).toBe(false);
    await signIn("9000022001");
    expect((await getApp()).status).toBe("REJECTED");
  });
  it("riders can only use the rider area; pharmacy and applicant endpoints do not cross over", async () => {
    await startApplicant("9000022001", "Kamal Singh", "RIDER");
    expect((await call((await route("pharmacy/orders")).GET, "GET", "/x")).status).toBe(403);
    await signIn("rider@example.com");
    expect((await call((await route("partner/application")).GET, "GET", "/x")).status).toBe(404); // an existing rider has no application
    await signIn("asha@example.com");
    expect((await call((await route("partner/application")).GET, "GET", "/x")).status).toBe(403);
  });
});

// ───────────── Admin-only and isolation ─────────────

describe("admin-only actions and data isolation", () => {
  it("only SUPER_ADMIN can see or decide applications; pharmacies and riders cannot see each other's", async () => {
    for (const who of ["asha@example.com", "pharmacy@example.com", "rider@example.com", undefined]) {
      await signIn(who);
      for (const [path, method, params, body] of [
        ["admin/applications", "GET"], ["admin/applications/[id]", "GET", { id: "app_1" }], ["admin/callbacks", "GET"], ["admin/analytics", "GET"],
        ["admin/applications/[id]/review", "POST", { id: "app_1" }, { action: "APPROVE" }], ["admin/applications/[id]/documents/[docId]", "POST", { id: "app_1", docId: "doc_1" }, { status: "APPROVED" }],
      ] as [string, string, Record<string, string>?, unknown?][]) {
        const r = await call((await route(path))[method], method, "/x", { params, body });
        expect(r.status, `${who ?? "anon"} ${path}`).toBe(who ? 403 : 401);
      }
    }
  });
  it("an applicant cannot approve themselves by any route", async () => {
    await startApplicant("9000011001", "Sita Rani", "PHARMACY");
    await fillApplication(PHARMACY, PHARMACY_DOCS); await submit();
    const id = appId("9000011001");
    const r = await call((await route("admin/applications/[id]/review")).POST, "POST", "/x", { params: { id }, body: { action: "APPROVE" } });
    expect(r.status).toBe(403);
    expect(db().partnerApplications.find((a) => a.id === id)!.status).toBe("SUBMITTED");
    expect((await call((await route("admin/pharmacies/[id]/verify")).POST, "POST", "/x", { params: { id: "ph_5" }, body: { status: "VERIFIED" } })).status).toBe(403);
  });
  it("viewing an application (personal data) and every decision are audit-logged with the admin's id", async () => {
    await signIn("admin@example.com");
    await call((await route("admin/applications/[id]")).GET, "GET", "/x", { params: { id: "app_1" } });
    await call((await route("admin/applications/[id]/review")).POST, "POST", "/x", { params: { id: "app_1" }, body: { action: "START_REVIEW" } });
    await call((await route("admin/applications/[id]/documents/[docId]")).POST, "POST", "/x", { params: { id: "app_1", docId: "doc_1" }, body: { status: "APPROVED" } });
    const actions = db().audit.filter((a) => a.actorId === "u_ad").map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(["APPLICATION_VIEWED", "APPLICATION_REVIEW_STARTED", "APPLICATION_DOCUMENT_REVIEWED"]));
  });
  it("seeded sample applications show up for review", async () => {
    await signIn("admin@example.com");
    const list = await call((await route("admin/applications")).GET, "GET", "/x");
    expect(list.body.data.map((a: { id: string }) => a.id).sort()).toEqual(["app_1", "app_2"]);
  });
});

// ───────────── Pharmacy-assisted ordering ─────────────

describe("pharmacy-assisted orders (consent, audit, no impersonation)", () => {
  const consent = async (mobile: string) => call((await route("pharmacy/assisted-orders/consent")).POST, "POST", "/x", { body: { mobile } });
  const grant = async (id: string, code: string, customerName?: string) => call((await route("pharmacy/assisted-orders/consent/[id]/verify")).POST, "POST", "/x", { params: { id }, body: { code, customerName } });
  const place = async (consentId: string, extra: Record<string, unknown> = {}) =>
    call((await route("pharmacy/assisted-orders")).POST, "POST", "/x", { body: { consentId, addressId: "ad_1", deliveryType: "NORMAL", items: [{ medicineId: MED.PARACETAMOL, quantity: 2 }], ...extra } });

  it("the code goes to the CUSTOMER's phone, not back to the pharmacy; with it, one order can be placed", async () => {
    await signIn("pharmacist@example.com");
    const c = await consent("9876543210");
    expect(c.status).toBe(200);
    const code = devOutbox.last("9876543210", "ASSISTED_CONSENT")!;
    expect(code).toMatch(/^\d{6}$/);
    // the pharmacy must not be able to place an order before the customer reads the code out
    expect((await place(c.body.data.consentId)).status).toBe(409);
    expect((await grant(c.body.data.consentId, "000000")).status).toBe(400);
    expect((await grant(c.body.data.consentId, code)).status).toBe(200);
    const o = await place(c.body.data.consentId);
    expect(o.status).toBe(201);
    const order = db().orders.find((x) => x.id === o.body.data.id)!;
    expect(order).toMatchObject({ userId: "u_1", pharmacyId: "ph_1", paymentMethod: "COD", assisted: { pharmacyId: "ph_1", staffUserId: "u_rx", consentId: c.body.data.consentId } });
    const first = db().orderStatusHistory.find((h) => h.orderId === order.id && !h.fromStatus)!;
    expect(first).toMatchObject({ changedBy: "u_rx", actorRole: "PHARMACIST" });
    expect(db().audit.map((a) => a.action)).toEqual(expect.arrayContaining(["ASSISTED_CONSENT_REQUESTED", "ASSISTED_CONSENT_GRANTED", "ASSISTED_ORDER_CREATED"]));
    expect(db().notifications.some((n) => n.userId === "u_1" && n.title === "Order placed for you")).toBe(true);
  });
  it("consent covers ONE order and expires after 30 minutes", async () => {
    await signIn("pharmacist@example.com");
    const c = await consent("9876543210");
    await grant(c.body.data.consentId, devOutbox.last("9876543210", "ASSISTED_CONSENT")!);
    expect((await place(c.body.data.consentId)).status).toBe(201);
    expect((await place(c.body.data.consentId)).status).toBe(409); // already used
    const c2 = await consent("9876500002").then(async (r) => { await grant(r.body.data.consentId, devOutbox.last("9876500002", "ASSISTED_CONSENT")!); return r; });
    vi.useFakeTimers({ now: Date.now() + 31 * 60_000 });
    expect((await place(c2.body.data.consentId, { addressId: "ad_3" })).status).toBe(409);
  });
  it("it is not impersonation: staff get no session as the customer and cannot read their data", async () => {
    await signIn("pharmacist@example.com");
    const c = await consent("9876543210");
    const g = await grant(c.body.data.consentId, devOutbox.last("9876543210", "ASSISTED_CONSENT")!);
    expect(g.headers.get("set-cookie")).toBeNull();
    expect(g.body.data.customer).toEqual({ id: "u_1", name: "Asha Verma" });
    expect((await call((await route("orders")).GET, "GET", "/x")).status).toBe(403);            // still a pharmacist
    expect((await call((await route("addresses")).GET, "GET", "/x")).body.data).toEqual([]);   // their own (none), never the customer's
    expect(JSON.stringify(g.body)).not.toMatch(/ad_1|Hanuman|9876543210/);
  });
  it("limits: own pharmacy only, over-the-counter only, customer's own address only, verified pharmacies only", async () => {
    await signIn("pharmacist@example.com");
    const c = await consent("9876543210");
    await grant(c.body.data.consentId, devOutbox.last("9876543210", "ASSISTED_CONSENT")!);
    expect((await place(c.body.data.consentId, { items: [{ medicineId: MED.METFORMIN, quantity: 1 }] })).body.message).toMatch(/needs a prescription/);
    expect((await place(c.body.data.consentId, { addressId: "ad_3" })).status).toBe(403);       // Rajesh's address
    await signIn("pharmacy2@example.com");                                                      // another pharmacy cannot use this consent
    expect((await place(c.body.data.consentId)).status).toBe(404);
    await signIn("asha@example.com");
    expect((await call((await route("pharmacy/assisted-orders/consent")).POST, "POST", "/x", { body: { mobile: "9876543210" } })).status).toBe(403);
    await signIn("pharmacy@example.com");
    db().pharmacies.find((p) => p.id === "ph_1")!.verification = "SUSPENDED";
    expect((await consent("9876543210")).status).toBe(403);
  });
  it("a number with no account needs the customer's name; the account is made only after their code", async () => {
    await signIn("pharmacist@example.com");
    const c = await consent("9000033001");
    expect(c.body.data.isNewCustomer).toBe(true);
    expect(db().users.some((u) => u.mobile === "9000033001")).toBe(false);
    const code = devOutbox.last("9000033001", "ASSISTED_CONSENT")!;
    expect((await grant(c.body.data.consentId, code)).status).toBe(400); // name missing
    expect(db().users.some((u) => u.mobile === "9000033001")).toBe(false);
  });
  it("a staff, admin or rider mobile cannot be used as a 'customer'", async () => {
    await signIn("pharmacist@example.com");
    expect((await consent("9822200001")).status).toBe(409);
    expect((await consent("9800000001")).status).toBe(409);
  });
});

// ───────────── Call-back requests ─────────────

describe("call-back requests", () => {
  it("anyone can ask; admins see and handle them; repeats do not flood the queue", async () => {
    const post = (await route("support/callback")).POST;
    expect((await call(post, "POST", "/x", { body: { mobile: "9000044001", name: "Ram", area: "Biswan", reason: "I cannot order medicines" } })).status).toBe(201);
    await call(post, "POST", "/x", { body: { mobile: "9000044001", area: "Biswan Chowk", reason: "Still need help" } });
    expect(db().callbackRequests.filter((c) => c.mobile === "9000044001")).toHaveLength(1);
    expect(db().callbackRequests[0]).toMatchObject({ area: "Biswan Chowk", reason: "Still need help", status: "OPEN" });
    expect((await call(post, "POST", "/x", { body: { mobile: "123", area: "x", reason: "y" } })).status).toBe(400);
    await signIn("asha@example.com");
    expect((await call((await route("admin/callbacks")).GET, "GET", "/x")).status).toBe(403);
    await signIn("admin@example.com");
    const list = await call((await route("admin/callbacks")).GET, "GET", "/api/admin/callbacks?status=OPEN");
    expect(list.body.data).toHaveLength(1);
    const id = list.body.data[0].id;
    const done = await call((await route("admin/callbacks/[id]")).PATCH, "PATCH", "/x", { params: { id }, body: { status: "CONTACTED", note: "Called, explained" } });
    expect(done.body.data).toMatchObject({ status: "CONTACTED", handledBy: "u_ad" });
  });
  it("is throttled per IP", async () => {
    const post = (await route("support/callback")).POST;
    let s = 201;
    for (let i = 0; i < 8; i++) s = (await call(post, "POST", "/x", { body: { mobile: `90000450${String(i).padStart(2, "0")}`, area: "Biswan", reason: "Help please" } })).status;
    expect(s).toBe(429);
  });
});

// ───────────── Addresses, preferences, i18n ─────────────

describe("addresses collected at checkout, with a default", () => {
  const addr = { label: "Home", contactName: "Meena Devi", contactMobile: "9000000101", pincode: "261001", state: "Uttar Pradesh", district: "Sitapur", town: "Sitapur", area: "Kaziyana", landmark: "Near the temple", houseDescription: "Blue gate", deliveryNotes: "Call at the gate" };
  it("a new customer has none; the first address becomes the default; a later one can take over", async () => {
    const rq = await call((await route("auth/otp/request")).POST, "POST", "/x", { body: { mobile: "9000000101" } });
    const v = await call((await route("auth/otp/verify")).POST, "POST", "/x", { body: { challengeId: rq.body.data.challengeId, code: devOutbox.last("9000000101")! } });
    const reg = await call((await route("auth/register")).POST, "POST", "/x", { body: { signupToken: v.body.data.signupToken, name: "Meena Devi", language: "hi", pincode: "261001", acceptTerms: true } });
    jar.token = /mc_session=([^;]+)/.exec(reg.headers.get("set-cookie") ?? "")![1];
    const list = async () => (await call((await route("addresses")).GET, "GET", "/x")).body.data;
    expect(await list()).toEqual([]);
    const a1 = (await call((await route("addresses")).POST, "POST", "/x", { body: addr })).body.data;
    expect(a1).toMatchObject({ isDefault: true, deliveryNotes: "Call at the gate" });
    const a2 = (await call((await route("addresses")).POST, "POST", "/x", { body: { ...addr, label: "Shop", isDefault: true, location: { lat: 27.57, lng: 80.68 } } })).body.data;
    expect(a2).toMatchObject({ isDefault: true, location: { lat: 27.57, lng: 80.68 } });
    const l = await list();
    expect(l.filter((a: { isDefault: boolean }) => a.isDefault)).toHaveLength(1);
    expect(l[0].id).toBe(a2.id);
    await call((await route("addresses/[id]")).PATCH, "PATCH", "/x", { params: { id: a1.id }, body: { isDefault: true } });
    expect((await list())[0].id).toBe(a1.id);
    await call((await route("addresses/[id]")).DELETE, "DELETE", "/x", { params: { id: a1.id } });
    expect((await list())[0]).toMatchObject({ id: a2.id, isDefault: true });
  });
  it("addresses are private to their owner", async () => {
    await signIn("asha@example.com");
    expect((await call((await route("addresses/[id]")).PATCH, "PATCH", "/x", { params: { id: "ad_3" }, body: { landmark: "Hacked" } })).status).toBe(403);
    expect((await call((await route("addresses/[id]")).DELETE, "DELETE", "/x", { params: { id: "ad_3" } })).status).toBe(403);
  });
});

describe("accessibility preferences and languages", () => {
  it("preferences persist on the account and are returned with the user", async () => {
    await signIn("asha@example.com");
    const r = await call((await route("me/preferences")).PATCH, "PATCH", "/x", { body: { largeText: true, largeControls: true, simplified: true, language: "hi" } });
    expect(r.body.data).toMatchObject({ language: "hi", preferences: { largeText: true, largeControls: true, simplified: true, highContrast: false } });
    const me = (await call((await route("auth/me")).GET, "GET", "/x")).body.data.user;
    expect(me.preferences).toMatchObject({ largeText: true, largeControls: true, simplified: true });
    expect((await call((await route("me/preferences")).PATCH, "PATCH", "/x", { body: { language: "klingon" } })).status).toBe(400);
    expect((await call((await route("me/preferences")).PATCH, "PATCH", "/x", { body: { role: "SUPER_ADMIN" } })).status).toBe(400);
  });
  it("every language registered has a dictionary, and Hindi covers all the sign-in and onboarding text", () => {
    expect(LANGUAGES.map((l) => l.code)).toEqual(["en", "hi"]);
    const authKeys = (Object.keys(en) as Key[]).filter((k) => /^(auth|mobile|sendCode|code|resend|changeNumber|devCode|yourName|preferredLanguage|yourLocation|useMyLocation|findingLocation|orEnter|pincodeLabel|checkArea|areaFound|notAvailable|tellMe|interestSaved|startShopping|termsAccept|stepOf|err|loginTo|guestNote|comfort|largeControls|simplified|callback|staffLogin|logoutEverywhere|yourDevices)/.test(k));
    expect(authKeys.length).toBeGreaterThan(40);
    const missing = authKeys.filter((k) => !(k in hi));
    expect(missing).toEqual([]);
  });
  it("translation falls back to English for a missing key and fills placeholders", () => {
    expect(translate("hi", "codeSentTo", { mobile: "98xxxxxx01" })).toBe("कोड 98xxxxxx01 पर भेजा गया");
    expect(translate("en", "areaFound", { area: "Sitapur" })).toBe("Good news! We deliver in Sitapur.");
    expect(translate("hi", "appName")).toBe("दवा दोस्त");
    const original = hi.callbackThanks;
    delete (hi as Record<string, string | undefined>).callbackThanks;
    expect(translate("hi", "callbackThanks")).toBe(en.callbackThanks);
    hi.callbackThanks = original;
  });
});
