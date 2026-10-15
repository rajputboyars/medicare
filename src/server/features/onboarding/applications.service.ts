import { validateUpload } from "@/lib/file-validation";
import type { ApplicationEvent, ApplicationStatus, ApplicationType, DocumentKind, DocumentStatus, PartnerApplication, PartnerDocument, SessionUser, User } from "@/lib/types";
import { badRequest, conflict, forbidden, notFound } from "../../errors";
import { audit, db, uid } from "../../store";
import { track } from "../../analytics";
import { notify } from "../notifications/notify";
import { pincodeCenter } from "../medicines/finder.service";
import { revokeAllSessions } from "../auth/session.service";
import { DOCUMENT_RULES, STEPS, partialSchema, requiredDocuments, type StepDef } from "./requirements";

/**
 * Pharmacy and rider applications.
 *
 *   DRAFT ──submit──▶ SUBMITTED ──start review──▶ UNDER_REVIEW ──approve──▶ APPROVED ──suspend──▶ SUSPENDED ──reinstate──▶ APPROVED
 *     ▲                   │                            │  └──reject──▶ REJECTED
 *     └──applicant fixes──┴── request more info ──▶ MORE_INFO_REQUIRED ──resubmit──▶ SUBMITTED
 *
 * The applicant can only edit in DRAFT and MORE_INFO_REQUIRED. The real Pharmacy / DeliveryPartner record is created only on
 * approval, so an applicant has no selling or delivering permission until then. Everything an admin does is in the event
 * history (and the audit log); internal notes never reach the applicant.
 */

const EDITABLE: ApplicationStatus[] = ["DRAFT", "MORE_INFO_REQUIRED"];
const REVIEWABLE: ApplicationStatus[] = ["SUBMITTED", "UNDER_REVIEW"];
const now = () => new Date().toISOString();
const roleOf = (a: SessionUser | "SYSTEM") => (a === "SYSTEM" ? "SYSTEM" : a.role);

function addEvent(app: PartnerApplication, actor: SessionUser | "SYSTEM", type: ApplicationEvent["type"], extra: Partial<ApplicationEvent> = {}) {
  app.events.push({ id: uid("ev"), at: now(), actorId: actor === "SYSTEM" ? "system" : actor.id, actorRole: roleOf(actor), type, ...extra });
  app.updatedAt = now();
}

function setStatus(app: PartnerApplication, to: ApplicationStatus, actor: SessionUser | "SYSTEM", type: ApplicationEvent["type"], note?: string, internal?: boolean) {
  const from = app.status;
  app.status = to;
  addEvent(app, actor, type, { fromStatus: from, toStatus: to, note, internal });
}

const typeOfRole = (u: Pick<SessionUser, "role">): ApplicationType => {
  if (u.role === "PHARMACY_ADMIN") return "PHARMACY";
  if (u.role === "DELIVERY_PARTNER") return "RIDER";
  throw forbidden();
};

// ───────────── Starting and resuming ─────────────

/**
 * A verified mobile becomes a partner applicant. The account is created with the partner role but NO partner profile.
 * A mobile that already belongs to someone else cannot be reused. Returning applicants simply sign in and continue.
 */
export function createApplicantAccount(input: { mobile: string; name: string; type: ApplicationType; language?: User["language"] }): { user: User; application: PartnerApplication } {
  const d = db();
  if (d.users.some((u) => u.mobile === input.mobile)) throw conflict("This mobile number already has an account. Please log in.");
  const t = now();
  const user: User = {
    id: uid("u"), name: input.name, mobile: input.mobile, role: input.type === "PHARMACY" ? "PHARMACY_ADMIN" : "DELIVERY_PARTNER", language: input.language ?? "en",
    preferences: { largeText: false, largeControls: false, simplified: false, highContrast: false },
    consent: { healthData: false, marketing: false, acceptedAt: t }, status: "ACTIVE", mobileVerifiedAt: t, createdAt: t,
  };
  d.users.push(user);
  const application: PartnerApplication = {
    id: uid("app"), type: input.type, userId: user.id, status: "DRAFT", step: 0, createdAt: t, updatedAt: t, events: [],
    data: input.type === "PHARMACY" ? { owner: { ownerName: input.name } } : { personal: { fullName: input.name } },
  };
  addEvent(application, user, "STARTED");
  d.partnerApplications.push(application);
  track(input.type === "PHARMACY" ? "pharmacy_registration_started" : "rider_registration_started", { userId: user.id });
  return { user, application };
}

/** The caller's own application. A returning applicant continues where they stopped. */
export function applicationOf(user: Pick<SessionUser, "id" | "role">): PartnerApplication {
  const type = typeOfRole(user);
  const app = db().partnerApplications.find((a) => a.userId === user.id && a.type === type);
  if (!app) throw notFound("You have not started an application yet");
  return app;
}

// ───────────── Progress ─────────────

export interface StepState { key: string; label: string; hint: string; complete: boolean; issues: Record<string, string> }

function stepComplete(app: PartnerApplication, def: StepDef): { complete: boolean; issues: Record<string, string> } {
  if (def.kind === "documents") {
    const docs = documentsOf(app.id);
    const missing = requiredDocuments(app.type, app.data).filter((r) => !docs.some((x) => x.kind === r.kind && x.status !== "REJECTED" && x.status !== "REUPLOAD_REQUESTED"));
    return { complete: missing.length === 0, issues: Object.fromEntries(missing.map((m) => [m.kind, `${m.label} is needed`])) };
  }
  if (def.kind === "review") return { complete: app.status !== "DRAFT" && app.status !== "MORE_INFO_REQUIRED", issues: {} };
  const r = def.full.safeParse(app.data[def.key] ?? {});
  if (r.success) return { complete: true, issues: {} };
  return { complete: false, issues: Object.fromEntries(r.error.issues.map((i) => [i.path.join(".") || "_", i.message])) };
}

/** Everything a screen needs to draw the progress bar and the "what is next" prompt. */
export function applicationProgress(app: PartnerApplication) {
  const steps: StepState[] = STEPS[app.type].map((def) => ({ key: def.key, label: def.label, hint: def.hint, ...stepComplete(app, def) }));
  const countable = steps.filter((s) => s.key !== "review");
  const done = countable.filter((s) => s.complete).length;
  const next = steps.find((s) => !s.complete && s.key !== "review");
  return {
    steps, percent: Math.round((done / countable.length) * 100), nextStep: next?.key ?? "review",
    canSubmit: countable.every((s) => s.complete) && EDITABLE.includes(app.status), editable: EDITABLE.includes(app.status),
  };
}

// ───────────── Saving (autosave) ─────────────

const stepDef = (type: ApplicationType, key: string): StepDef => {
  const d = STEPS[type].find((s) => s.key === key);
  if (!d) throw badRequest("Unknown step");
  return d;
};

function assertEditable(app: PartnerApplication) {
  if (!EDITABLE.includes(app.status)) throw conflict(app.status === "APPROVED" ? "Your application is already approved." : "Your application is being reviewed. You cannot change it now.");
}

/** Autosave one step. Partial answers are fine; formats are still checked. */
export function saveStep(user: SessionUser, stepKey: string, input: unknown): PartnerApplication {
  const app = applicationOf(user);
  assertEditable(app);
  const def = stepDef(app.type, stepKey);
  if (def.kind) throw badRequest("This step is saved by uploading or submitting");
  const parsed = partialSchema(def).safeParse(input);
  if (!parsed.success) {
    const fields = Object.fromEntries(parsed.error.issues.map((i) => [i.path.join(".") || "_", i.message]));
    throw badRequest(Object.values(fields)[0] ?? "Please check the details", fields);
  }
  app.data[stepKey] = { ...(app.data[stepKey] ?? {}), ...parsed.data };
  const idx = STEPS[app.type].findIndex((s) => s.key === stepKey);
  app.step = Math.max(app.step, Math.min(idx + 1, STEPS[app.type].length - 1));
  app.updatedAt = now();
  return app;
}

// ───────────── Documents ─────────────

const EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "application/pdf": "pdf" };
export const documentsOf = (applicationId: string) => db().partnerDocuments.filter((x) => x.applicationId === applicationId);

/** What the owner and admins see about a document: never the storage key. */
export const documentView = ({ fileKey: _k, ...doc }: PartnerDocument) => { void _k; return doc; };

export function uploadDocument(user: SessionUser, input: { kind: DocumentKind; label?: string; file: { name: string; type: string; bytes: Uint8Array } }): PartnerDocument {
  const app = applicationOf(user);
  assertEditable(app);
  const rule = DOCUMENT_RULES[app.type].find((r) => r.kind === input.kind);
  if (!rule) throw badRequest("This document is not needed for your application");
  const check = validateUpload({ type: input.file.type, size: input.file.bytes.byteLength }, input.file.bytes.slice(0, 8));
  if (!check.ok) throw badRequest(check.error);
  const d = db();
  // A new file replaces the old one of the same kind (except "other documents", which can be many)
  if (!rule.multiple) for (const old of documentsOf(app.id).filter((x) => x.kind === input.kind)) removeStored(old);
  else if (documentsOf(app.id).filter((x) => x.kind === input.kind).length >= 6) throw badRequest("You can add up to 6 of these");
  const id = uid("doc");
  const fileKey = `${id}.${EXT[input.file.type]}`;
  d.files.set(fileKey, { bytes: input.file.bytes, mimeType: input.file.type, ownerId: user.id });
  const doc: PartnerDocument = {
    id, applicationId: app.id, uploadedBy: user.id, kind: input.kind, label: input.label?.slice(0, 60), fileKey, fileName: input.file.name.slice(0, 120),
    mimeType: input.file.type, sizeBytes: input.file.bytes.byteLength, status: "UPLOADED", createdAt: now(),
  };
  d.partnerDocuments.push(doc);
  addEvent(app, user, "DOCUMENT_UPLOADED", { note: rule.label });
  return doc;
}

function removeStored(doc: PartnerDocument) {
  const d = db();
  d.files.delete(doc.fileKey);
  d.partnerDocuments = d.partnerDocuments.filter((x) => x.id !== doc.id);
}

export function removeDocument(user: SessionUser, documentId: string) {
  const app = applicationOf(user);
  assertEditable(app);
  const doc = documentsOf(app.id).find((x) => x.id === documentId);
  if (!doc) throw notFound("Document not found");
  if (doc.status === "APPROVED") throw conflict("An approved document cannot be removed");
  removeStored(doc);
  addEvent(app, user, "DOCUMENT_REMOVED", { note: doc.kind });
}

/** Who may open an application file: the applicant who uploaded it, and platform admins. Nobody else, ever. */
export function canAccessDocument(user: SessionUser, doc: PartnerDocument): boolean {
  return user.role === "SUPER_ADMIN" || doc.uploadedBy === user.id;
}

export function documentFor(user: SessionUser, id: string): PartnerDocument {
  const doc = db().partnerDocuments.find((x) => x.id === id);
  if (!doc) throw notFound("Document not found");
  if (!canAccessDocument(user, doc)) throw forbidden();
  return doc;
}

// ───────────── Submitting ─────────────

export function submitApplication(user: SessionUser, consent: boolean): PartnerApplication {
  const app = applicationOf(user);
  assertEditable(app);
  if (!consent) throw badRequest("Please confirm the details are correct", { consent: "Please confirm the details are correct" });
  const progress = applicationProgress(app);
  const missing = progress.steps.filter((s) => s.key !== "review" && !s.complete);
  if (missing.length) throw badRequest(`Please finish: ${missing.map((m) => m.label).join(", ")}`, Object.fromEntries(missing.map((m) => [m.key, Object.values(m.issues)[0] ?? "Not finished"])));
  // Documents an admin asked to replace must have been replaced
  if (documentsOf(app.id).some((x) => x.status === "REJECTED" || x.status === "REUPLOAD_REQUESTED")) throw badRequest("Please upload the documents we asked you to replace");
  app.data.review = { consent: true, at: now() };
  app.submittedAt = now();
  app.step = STEPS[app.type].length - 1;
  setStatus(app, "SUBMITTED", user, "SUBMITTED");
  track(app.type === "PHARMACY" ? "pharmacy_application_submitted" : "rider_application_submitted", { userId: user.id });
  return app;
}

// ───────────── Admin review ─────────────

const find = (id: string) => {
  const app = db().partnerApplications.find((a) => a.id === id);
  if (!app) throw notFound("Application not found");
  return app;
};
const needNote = (note?: string, msg = "Please write a note for the applicant") => { if (!note?.trim() || note.trim().length < 3) throw badRequest(msg, { note: msg }); return note.trim(); };

export function listApplications() {
  const d = db();
  return d.partnerApplications.map((a) => {
    const user = d.users.find((u) => u.id === a.userId);
    const docs = documentsOf(a.id);
    const required = requiredDocuments(a.type, a.data);
    const p = applicationProgress(a);
    return {
      id: a.id, type: a.type, status: a.status, name: nameOf(a), mobile: user?.mobile, district: (a.data.address?.district as string | undefined) ?? undefined,
      percent: p.percent, documents: docs.length, documentsToCheck: docs.filter((x) => x.status === "UPLOADED").length, requiredDocuments: required.length,
      submittedAt: a.submittedAt, updatedAt: a.updatedAt, createdAt: a.createdAt,
    };
  });
}

export function nameOf(a: PartnerApplication): string {
  const d = a.data;
  return String(d.store?.storeName ?? d.personal?.fullName ?? d.owner?.ownerName ?? "New applicant");
}

/** Full detail for the review screen, including internal notes. Never includes storage keys. */
export function applicationDetail(id: string) {
  const app = find(id);
  const user = db().users.find((u) => u.id === app.userId);
  return {
    ...app, name: nameOf(app), user: user && { id: user.id, name: user.name, mobile: user.mobile, email: user.email, status: user.status },
    documents: documentsOf(app.id).map(documentView), requiredDocuments: requiredDocuments(app.type, app.data).map((r) => r.kind),
    documentRules: DOCUMENT_RULES[app.type].map(({ requiredWhen: _w, ...r }) => { void _w; return r; }),
    progress: applicationProgress(app),
  };
}

/** What the applicant sees: no internal notes, no admin identities. */
export function applicantView(app: PartnerApplication) {
  const events = app.events.filter((e) => !e.internal && ["SUBMITTED", "INFO_REQUESTED", "APPROVED", "REJECTED", "SUSPENDED", "REINSTATED", "REVIEW_STARTED"].includes(e.type))
    .map((e) => ({ id: e.id, at: e.at, type: e.type, toStatus: e.toStatus, note: e.note }));
  const rules = DOCUMENT_RULES[app.type].map(({ requiredWhen: _w, ...r }) => ({ ...r, required: r.required && (_w ? _w(app.data) : true) }));
  return {
    id: app.id, type: app.type, status: app.status, step: app.step, data: app.data, events, progress: applicationProgress(app),
    steps: STEPS[app.type].map((s) => ({ key: s.key, label: s.label, hint: s.hint, kind: s.kind })),
    documentRules: rules, documents: documentsOf(app.id).map(documentView), submittedAt: app.submittedAt, decidedAt: app.decidedAt,
  };
}

export function startReview(actor: SessionUser, id: string) {
  const app = find(id);
  if (app.status !== "SUBMITTED") throw conflict("Only submitted applications can be picked up for review");
  setStatus(app, "UNDER_REVIEW", actor, "REVIEW_STARTED");
  audit(actor, "APPLICATION_REVIEW_STARTED", "PartnerApplication", id);
  return app;
}

export function reviewDocument(actor: SessionUser, applicationId: string, documentId: string, status: Exclude<DocumentStatus, "UPLOADED">, note?: string) {
  const app = find(applicationId);
  if (!REVIEWABLE.includes(app.status) && app.status !== "MORE_INFO_REQUIRED") throw conflict("This application is not open for document review");
  const doc = documentsOf(app.id).find((x) => x.id === documentId);
  if (!doc) throw notFound("Document not found");
  const text = status === "APPROVED" ? note?.trim() : needNote(note, "Tell the applicant what is wrong with this document");
  doc.status = status;
  doc.reviewNote = text;
  doc.reviewedBy = actor.id;
  doc.reviewedAt = now();
  addEvent(app, actor, "DOCUMENT_REVIEWED", { note: `${doc.kind}: ${status}${text ? ` · ${text}` : ""}` });
  audit(actor, "APPLICATION_DOCUMENT_REVIEWED", "PartnerDocument", doc.id, { status, applicationId });
  return doc;
}

export function requestInfo(actor: SessionUser, id: string, note: string | undefined) {
  const app = find(id);
  if (!REVIEWABLE.includes(app.status)) throw conflict("Only applications under review can be sent back");
  const text = needNote(note, "Tell the applicant what we need");
  setStatus(app, "MORE_INFO_REQUIRED", actor, "INFO_REQUESTED", text);
  const user = db().users.find((u) => u.id === app.userId);
  if (user) notify(user.id, "APPLICATION_UPDATE", "We need a little more information", text);
  audit(actor, "APPLICATION_INFO_REQUESTED", "PartnerApplication", id, { note: text });
  return app;
}

export function addInternalNote(actor: SessionUser, id: string, note: string | undefined) {
  const app = find(id);
  addEvent(app, actor, "NOTE", { note: needNote(note, "Write a note"), internal: true });
  audit(actor, "APPLICATION_NOTE_ADDED", "PartnerApplication", id);
  return app;
}

export function rejectApplication(actor: SessionUser, id: string, note: string | undefined) {
  const app = find(id);
  if (!REVIEWABLE.includes(app.status)) throw conflict("Only applications under review can be rejected");
  const text = needNote(note, "Tell the applicant why");
  setStatus(app, "REJECTED", actor, "REJECTED", text);
  app.decidedAt = now();
  app.decidedBy = actor.id;
  audit(actor, "APPLICATION_REJECTED", "PartnerApplication", id, { note: text });
  return app;
}

/** Approval creates the real partner profile. Every required document must have been approved first. */
export function approveApplication(actor: SessionUser, id: string, note?: string) {
  const app = find(id);
  if (!REVIEWABLE.includes(app.status)) throw conflict("Only applications under review can be approved");
  const docs = documentsOf(app.id);
  const notApproved = requiredDocuments(app.type, app.data).filter((r) => !docs.some((x) => x.kind === r.kind && x.status === "APPROVED"));
  if (notApproved.length) throw badRequest(`Approve these documents first: ${notApproved.map((r) => r.label).join(", ")}`);
  const progress = applicationProgress(app);
  const unfinished = progress.steps.filter((s) => s.key !== "review" && !s.complete);
  if (unfinished.length) throw badRequest(`Some answers are incomplete: ${unfinished.map((s) => s.label).join(", ")}`);
  const user = db().users.find((u) => u.id === app.userId);
  if (!user) throw notFound("Applicant account not found");
  app.partnerId = app.type === "PHARMACY" ? createPharmacy(app, user) : createRider(app, user);
  user.partnerId = app.partnerId;
  setStatus(app, "APPROVED", actor, "APPROVED", note?.trim() || undefined);
  app.decidedAt = now();
  app.decidedBy = actor.id;
  audit(actor, "APPLICATION_APPROVED", "PartnerApplication", id, { partnerId: app.partnerId, type: app.type });
  if (app.type === "PHARMACY") track("pharmacy_approved", { userId: user.id });
  notify(user.id, "APPLICATION_UPDATE", "You are approved", app.type === "PHARMACY" ? "Your pharmacy is approved. Finish the setup checklist to start selling." : "You are approved. Go online to receive deliveries.");
  return app;
}

function createPharmacy(app: PartnerApplication, user: User): string {
  const d = db();
  const a = app.data.address as Record<string, unknown>, l = app.data.license as Record<string, unknown>, s = app.data.store as Record<string, unknown>;
  const dl = app.data.delivery as Record<string, unknown>, o = app.data.owner as Record<string, unknown>;
  if (d.pharmacies.some((p) => p.drugLicense === l.drugLicenseNumber)) throw conflict("A pharmacy with this drug licence already exists");
  const pincode = String(a.pincode);
  const at = typeof a.lat === "number" && typeof a.lng === "number" ? { lat: a.lat, lng: a.lng } : (pincodeCenter(pincode) ?? d.pharmacies.find((p) => p.district === a.district)?.location ?? { lat: 0, lng: 0 });
  const id = uid("ph");
  d.pharmacies.push({
    id, name: String(s.storeName), ownerName: String(o.ownerName), mobile: user.mobile, drugLicense: String(l.drugLicenseNumber), gstin: (l.gstin as string) || undefined,
    verification: "VERIFIED", address: `${a.address}, ${a.area}, ${a.town}`, pincode, district: String(a.district), location: at,
    servicePincodes: dl.servicePincodes as string[], deliveryRadiusKm: Number(dl.radiusKm), openTime: String(dl.openTime), closeTime: String(dl.closeTime),
    priorityDelivery: !!dl.priorityDelivery, avgPrepMinutes: Number(dl.avgPrepMinutes), rating: 0, ratingCount: 0,
    // Selling stays OFF until the checklist (stock, bank, training) is done and the owner switches it on
    acceptingOrders: false, onboarding: { deliverySettingsDone: true, trainingDone: false, walkthroughSeen: false },
  });
  user.name = String(o.ownerName);
  return id;
}

function createRider(app: PartnerApplication, user: User): string {
  const d = db();
  const p = app.data.personal as Record<string, unknown>, v = app.data.vehicle as Record<string, unknown>;
  const id = uid("dp");
  d.deliveryPartners.push({
    id, userId: user.id, name: String(p.fullName), mobile: user.mobile, vehicle: `${String(v.vehicleType).toLowerCase()} ${v.vehicleNumber ?? ""}`.trim(),
    verification: "VERIFIED", available: false, joinedAt: now(),
  });
  user.name = String(p.fullName);
  return id;
}

/** Suspending takes effect immediately: the partner can no longer sell or deliver, and their devices are signed out. */
export function suspendApplication(actor: SessionUser, id: string, note: string | undefined) {
  const app = find(id);
  if (app.status !== "APPROVED") throw conflict("Only approved partners can be suspended");
  const text = needNote(note, "Tell the partner why");
  setStatus(app, "SUSPENDED", actor, "SUSPENDED", text);
  setPartnerVerification(app, "SUSPENDED");
  if (app.userId) revokeAllSessions(app.userId, "partner-suspended");
  audit(actor, "APPLICATION_SUSPENDED", "PartnerApplication", id, { note: text });
  return app;
}

export function reinstateApplication(actor: SessionUser, id: string, note?: string) {
  const app = find(id);
  if (app.status !== "SUSPENDED") throw conflict("Only suspended partners can be reinstated");
  setStatus(app, "APPROVED", actor, "REINSTATED", note?.trim() || undefined);
  setPartnerVerification(app, "VERIFIED");
  audit(actor, "APPLICATION_REINSTATED", "PartnerApplication", id);
  return app;
}

function setPartnerVerification(app: PartnerApplication, v: "VERIFIED" | "SUSPENDED") {
  const d = db();
  if (app.type === "PHARMACY") {
    const p = d.pharmacies.find((x) => x.id === app.partnerId);
    if (p) { p.verification = v; if (v === "SUSPENDED") p.acceptingOrders = false; }
  } else {
    const r = d.deliveryPartners.find((x) => x.id === app.partnerId);
    if (r) { r.verification = v; if (v === "SUSPENDED") r.available = false; }
  }
}

