import { describe, expect, it } from "vitest";
import { can, AREA_ROLES } from "@/lib/rbac";
import { estimateEta } from "@/lib/eta";
import { distanceKm, isOpenNow } from "@/lib/geo";
import { validateUpload } from "@/lib/file-validation";
import { MemoryRateLimiter } from "@/lib/rate-limit";
import { signFileUrl, verifyFileSignature } from "@/lib/signed-url";
import { signSession, verifySession } from "@/lib/auth";
import { addressSchema, createOrderSchema, parseCsv, registerSchema } from "@/lib/validation";
import { applyOffer, deliveryFee } from "@/lib/pricing";
import { ORDER_STATUSES } from "@/lib/types";
import { FINAL_STATUSES, TRANSITIONS, allowedNext, canTransition, happyPath, timeline } from "@/lib/order-machine";

describe("RBAC", () => {
  it("grants only the intended capabilities", () => {
    expect(can("CUSTOMER", "order:create")).toBe(true);
    expect(can("CUSTOMER", "admin:read")).toBe(false);
    expect(can("DELIVERY_PARTNER", "prescription:review")).toBe(false);
    expect(can("DELIVERY_PARTNER", "order:read:pharmacy")).toBe(false);
    expect(can("PHARMACIST", "pharmacy:manage")).toBe(false);
    expect(can("PHARMACY_ADMIN", "pharmacy:manage")).toBe(true);
    expect(can("PHARMACIST", "admin:write")).toBe(false);
    expect(can("SUPER_ADMIN", "admin:write")).toBe(true);
    expect(can("SUPER_ADMIN", "order:create")).toBe(false);
    expect(can(undefined, "order:create")).toBe(false);
  });
  it("protects every portal area", () => {
    expect(AREA_ROLES.admin).not.toContain("USER");
    expect(AREA_ROLES.delivery).not.toContain("PHARMACIST");
  });
});

describe("ETA", () => {
  const base = { distanceKm: 2, prepMinutes: 10, needsPrescriptionReview: false, riderAvailable: true, deliveryType: "NORMAL" as const };
  it("never promises sub-20-minute delivery", () => {
    expect(estimateEta({ ...base, distanceKm: 0.2, prepMinutes: 2, deliveryType: "PRIORITY" }).minutes).toBeGreaterThanOrEqual(20);
  });
  it("accounts for prescription review, rider availability and distance", () => {
    const quick = estimateEta(base).minutes;
    expect(estimateEta({ ...base, needsPrescriptionReview: true }).minutes).toBeGreaterThan(quick);
    expect(estimateEta({ ...base, riderAvailable: false }).minutes).toBeGreaterThan(quick);
    expect(estimateEta({ ...base, distanceKm: 8 }).minutes).toBeGreaterThan(quick);
    expect(estimateEta({ ...base, deliveryType: "PRIORITY" }).minutes).toBeLessThanOrEqual(quick);
  });
  it("returns a range wider than the point estimate", () => {
    const e = estimateEta(base);
    expect(e.range[1]).toBeGreaterThan(e.range[0]);
  });
});

describe("geo", () => {
  it("computes plausible distances", () => {
    expect(distanceKm({ lat: 27.5683, lng: 80.6827 }, { lat: 27.5741, lng: 80.6912 })).toBeGreaterThan(0.5);
    expect(distanceKm({ lat: 27, lng: 80 }, { lat: 27, lng: 80 })).toBe(0);
  });
  it("checks opening hours", () => {
    expect(isOpenNow("08:00", "22:00", new Date("2026-01-01T10:00:00"))).toBe(true);
    expect(isOpenNow("08:00", "22:00", new Date("2026-01-01T23:00:00"))).toBe(false);
  });
});

describe("file validation", () => {
  it("accepts a real PNG and rejects spoofed, oversize and unsupported files", () => {
    expect(validateUpload({ type: "image/png", size: 100 }, new Uint8Array([0x89, 0x50, 0x4e, 0x47])).ok).toBe(true);
    expect(validateUpload({ type: "image/png", size: 100 }, new Uint8Array([0x4d, 0x5a, 0, 0])).ok).toBe(false);
    expect(validateUpload({ type: "image/png", size: 9 * 1024 * 1024 }, new Uint8Array([0x89, 0x50, 0x4e, 0x47])).ok).toBe(false);
    expect(validateUpload({ type: "application/x-msdownload", size: 10 }, new Uint8Array([0x4d, 0x5a])).ok).toBe(false);
    expect(validateUpload({ type: "application/pdf", size: 0 }, new Uint8Array()).ok).toBe(false);
  });
});

describe("rate limiter", () => {
  it("blocks after the limit and reports retry time", () => {
    const l = new MemoryRateLimiter();
    for (let i = 0; i < 3; i++) expect(l.hit("k", 3, 1000).allowed).toBe(true);
    const r = l.hit("k", 3, 1000);
    expect(r.allowed).toBe(false);
    expect(r.retryAfterSec).toBeGreaterThan(0);
    expect(l.hit("other", 3, 1000).allowed).toBe(true);
  });
});

describe("signed file URLs", () => {
  it("verifies, binds to user and rejects tampering/expiry", () => {
    const url = new URL(signFileUrl("rx_1.png", "u_1", 60), "http://x");
    const exp = Number(url.searchParams.get("exp"));
    const sig = url.searchParams.get("sig")!;
    expect(url.toString()).not.toMatch(/Metformin|name/i);
    expect(verifyFileSignature("rx_1.png", exp, "u_1", sig)).toBe(true);
    expect(verifyFileSignature("rx_1.png", exp, "u_2", sig)).toBe(false);
    expect(verifyFileSignature("rx_2.png", exp, "u_1", sig)).toBe(false);
    const old = new URL(signFileUrl("rx_1.png", "u_1", -10), "http://x");
    expect(verifyFileSignature("rx_1.png", Number(old.searchParams.get("exp")), "u_1", old.searchParams.get("sig")!)).toBe(false);
  });
});

describe("sessions", () => {
  it("round-trips and rejects garbage", async () => {
    const t = await signSession({ id: "u1", name: "A", role: "PHARMACIST", partnerId: "ph_1" });
    expect(await verifySession(t)).toMatchObject({ id: "u1", role: "PHARMACIST", partnerId: "ph_1" });
    expect(await verifySession(t + "x")).toBeNull();
    expect(await verifySession("nope")).toBeNull();
    expect(await verifySession(undefined)).toBeNull();
  });
});

describe("validation", () => {
  it("requires a landmark and a valid pincode for addresses", () => {
    const ok = { contactName: "Asha", contactMobile: "9876543210", pincode: "261001", state: "UP", district: "Sitapur", town: "Sitapur", area: "Kaziyana", landmark: "Near Hanuman Mandir", houseDescription: "Blue gate" };
    expect(addressSchema.safeParse(ok).success).toBe(true);
    expect(addressSchema.safeParse({ ...ok, landmark: "" }).success).toBe(false);
    expect(addressSchema.safeParse({ ...ok, pincode: "12" }).success).toBe(false);
    expect(addressSchema.safeParse({ ...ok, contactMobile: "1234567890" }).success).toBe(false);
  });
  it("enforces strong registration with consent", () => {
    const base = { name: "Asha", mobile: "9876543210", password: "abcdefg1", consentHealthData: true as const };
    expect(registerSchema.safeParse(base).success).toBe(true);
    expect(registerSchema.safeParse({ ...base, password: "short" }).success).toBe(false);
    expect(registerSchema.safeParse({ ...base, consentHealthData: false }).success).toBe(false);
  });
  it("caps quantities and requires items", () => {
    const o = { pharmacyId: "p", addressId: "a", paymentMethod: "COD", items: [{ medicineId: "m", quantity: 99 }] };
    expect(createOrderSchema.safeParse(o).success).toBe(false);
    expect(createOrderSchema.safeParse({ ...o, items: [] }).success).toBe(false);
  });
  it("parses quoted CSV", () => {
    expect(parseCsv('a,"b,c",d\n1,2,3\r\n')).toEqual([["a", "b,c", "d"], ["1", "2", "3"]]);
  });
});

describe("pricing", () => {
  it("charges delivery fees fairly", () => {
    expect(deliveryFee(100, "NORMAL")).toBe(25);
    expect(deliveryFee(600, "NORMAL")).toBe(0);
    expect(deliveryFee(600, "PRIORITY")).toBe(49);
    const offer = { id: "o", title: "", description: "", code: "X", percentOff: 10, maxDiscount: 75, minOrder: 200, active: true };
    expect(applyOffer(100, offer)).toBe(0);
    expect(applyOffer(500, offer)).toBe(50);
    expect(applyOffer(5000, offer)).toBe(75);
  });
});

describe("order state machine", () => {
  it("defines exactly the 11 V1 statuses", () => {
    expect([...ORDER_STATUSES]).toEqual(["PENDING", "PRESCRIPTION_REVIEW", "PRESCRIPTION_APPROVED", "CONFIRMED", "PREPARING", "READY_FOR_PICKUP", "RIDER_ASSIGNED", "PICKED_UP", "OUT_FOR_DELIVERY", "DELIVERED", "CANCELLED"]);
    for (const s of ORDER_STATUSES) expect(TRANSITIONS[s]).toBeDefined();
  });
  it("final states have no exits", () => {
    for (const s of FINAL_STATUSES) expect(TRANSITIONS[s]).toEqual([]);
  });
  it("every non-final state can reach DELIVERED or CANCELLED (no dead ends)", () => {
    const reach = (from: (typeof ORDER_STATUSES)[number], seen = new Set<string>()): boolean => {
      if (from === "DELIVERED" || from === "CANCELLED") return true;
      if (seen.has(from)) return false;
      seen.add(from);
      return TRANSITIONS[from].some((e) => reach(e.to, seen));
    };
    for (const s of ORDER_STATUSES) expect(reach(s)).toBe(true);
  });
  it("only the right roles may move an order", () => {
    expect(canTransition("PENDING", "CONFIRMED", "PHARMACIST")).toBe(true);
    expect(canTransition("PENDING", "CONFIRMED", "CUSTOMER")).toBe(false);
    expect(canTransition("PENDING", "CONFIRMED", "DELIVERY_PARTNER")).toBe(false);
    expect(canTransition("PRESCRIPTION_REVIEW", "PRESCRIPTION_APPROVED", "DELIVERY_PARTNER")).toBe(false);
    expect(canTransition("RIDER_ASSIGNED", "PICKED_UP", "DELIVERY_PARTNER")).toBe(true);
    expect(canTransition("RIDER_ASSIGNED", "PICKED_UP", "PHARMACY_ADMIN")).toBe(false);
    expect(canTransition("OUT_FOR_DELIVERY", "DELIVERED", "CUSTOMER")).toBe(false);
    expect(canTransition("DELIVERED", "CANCELLED", "SUPER_ADMIN")).toBe(false);
  });
  it("forbids skipping steps and going backwards", () => {
    expect(canTransition("PENDING", "PREPARING", "PHARMACIST")).toBe(false);
    expect(canTransition("CONFIRMED", "READY_FOR_PICKUP", "PHARMACIST")).toBe(false);
    expect(canTransition("PREPARING", "CONFIRMED", "PHARMACIST")).toBe(false);
    expect(canTransition("PRESCRIPTION_REVIEW", "CONFIRMED", "PHARMACIST")).toBe(false);
  });
  it("customer cancel cut-off is before pickup", () => {
    expect(allowedNext("RIDER_ASSIGNED", "CUSTOMER")).toContain("CANCELLED");
    expect(allowedNext("PICKED_UP", "CUSTOMER")).not.toContain("CANCELLED");
    expect(allowedNext("OUT_FOR_DELIVERY", "SUPER_ADMIN")).toContain("CANCELLED");
  });
  it("timeline shows review steps only for prescription orders", () => {
    expect(happyPath(false)[0]).toBe("PENDING");
    expect(happyPath(true).slice(0, 2)).toEqual(["PRESCRIPTION_REVIEW", "PRESCRIPTION_APPROVED"]);
    const t = timeline({ items: [{ prescriptionRequired: false }], statusHistory: [{ status: "PENDING", at: "x" }, { status: "CONFIRMED", at: "y" }], status: "CONFIRMED" });
    expect(t.filter((s) => s.done).map((s) => s.status)).toEqual(["PENDING", "CONFIRMED"]);
    expect(t.find((s) => s.current)!.status).toBe("CONFIRMED");
  });
});
