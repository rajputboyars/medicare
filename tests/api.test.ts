import { beforeEach, describe, expect, it, vi } from "vitest";
import { signSession } from "@/lib/auth";
import { MED } from "@/server/seed";
import { db, resetDb } from "@/server/store";
import { toSession } from "@/server/features/accounts/accounts.service";
import { codeFor, deliveryOf } from "@/server/features/orders/orders.service";
import { rateLimiter } from "@/lib/rate-limit";

/** These tests call the real route handlers. Only the cookie jar and request headers are faked. */
const jar: { token?: string } = {};
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (jar.token ? { name, value: jar.token } : undefined) }),
  headers: async () => new Headers(),
}));

type Ctx = { params: Promise<Record<string, string>> };
type Handler = (req: Request, ctx: Ctx) => Promise<Response>;
interface Reply { status: number; body: { success: boolean; data: any; message: string | null; errors: { code: string; message: string; field?: string }[] | null; meta: any }; headers: Headers } // eslint-disable-line @typescript-eslint/no-explicit-any

async function signIn(identifier?: string) {
  jar.token = undefined;
  if (!identifier) return;
  const u = db().users.find((x) => x.mobile === identifier || x.email === identifier)!;
  jar.token = await signSession(toSession(u));
}

async function call(handler: Handler, method: string, url: string, opts: { body?: unknown; params?: Record<string, string> } = {}): Promise<Reply> {
  const req = new Request(`http://localhost${url}`, { method, headers: opts.body ? { "content-type": "application/json" } : {}, body: opts.body ? JSON.stringify(opts.body) : undefined });
  const res = await handler(req, { params: Promise.resolve(opts.params ?? {}) });
  return { status: res.status, body: await res.json(), headers: res.headers };
}

const route = async (path: string) => (await import(/* @vite-ignore */ `@/app/api/${path}/route`)) as Record<string, Handler>;
const ASHA = "asha@example.com";
const RAJESH = "rajesh@example.com";
const OWNER = "pharmacy@example.com";
const PHARMACIST = "pharmacist@example.com";
const OWNER2 = "pharmacy2@example.com";
const RIDER1 = "rider@example.com";
const RIDER4 = "rider4@example.com";
const ADMIN = "admin@example.com";
const order = { pharmacyId: "ph_1", addressId: "ad_1", deliveryType: "NORMAL", paymentMethod: "COD", items: [{ medicineId: MED.PARACETAMOL, quantity: 2 }] };

beforeEach(() => { resetDb(); jar.token = undefined; rateLimiter.reset?.(); });

describe("response envelope", () => {
  it("every response has success, data, message, errors, meta", async () => {
    await signIn(ASHA);
    const ok = await call((await route("orders")).GET, "GET", "/api/orders");
    expect(Object.keys(ok.body).sort()).toEqual(["data", "errors", "message", "meta", "success"]);
    expect(ok.body.success).toBe(true);
    await signIn();
    const bad = await call((await route("orders")).GET, "GET", "/api/orders");
    expect(bad.status).toBe(401);
    expect(bad.body).toMatchObject({ success: false, data: null, errors: [{ code: "UNAUTHENTICATED" }] });
  });
  it("lists are paginated, sortable and filterable, and bad options are refused", async () => {
    await signIn(OWNER);
    const list = (await route("pharmacy/orders")).GET;
    const all = await call(list, "GET", "/api/pharmacy/orders");
    expect(all.body.meta).toMatchObject({ page: 1, total: all.body.data.length });
    const page = await call(list, "GET", "/api/pharmacy/orders?limit=2&page=2&sort=createdAt:asc");
    expect(page.body.data).toHaveLength(Math.min(2, Math.max(0, all.body.meta.total - 2)));
    expect(page.body.meta).toMatchObject({ page: 2, limit: 2, sort: "createdAt:asc" });
    const filtered = await call(list, "GET", "/api/pharmacy/orders?status=DELIVERED");
    expect(filtered.body.data.every((o: { status: string }) => o.status === "DELIVERED")).toBe(true);
    expect((await call(list, "GET", "/api/pharmacy/orders?sort=password:asc")).status).toBe(400);
    expect((await call(list, "GET", "/api/pharmacy/orders?limit=5000")).status).toBe(400);
  });
});

describe("authentication", () => {
  it("registers a customer, never exposes the password hash, and ignores any attempt to pick a role", async () => {
    const { POST } = await route("auth/register");
    const body = { name: "New Person", mobile: "9000000001", password: "Strong#123", consentHealthData: true };
    const r = await call(POST, "POST", "/api/auth/register", { body });
    expect(r.status).toBe(201);
    expect(r.body.data.user.role).toBe("CUSTOMER");
    expect(JSON.stringify(r.body)).not.toMatch(/passwordHash|\$2[aby]\$/);
    expect(r.headers.get("set-cookie")).toMatch(/mc_session=.+HttpOnly/i);
    const stored = db().users.find((u) => u.mobile === "9000000001")!;
    expect(stored.passwordHash).toMatch(/^\$2[aby]\$/); // bcrypt, not plain text
    expect(stored.passwordHash).not.toContain("Strong#123");
    const sneaky = await call(POST, "POST", "/api/auth/register", { body: { ...body, mobile: "9000000002", role: "SUPER_ADMIN" } });
    expect(sneaky.status).toBe(400);
    expect(db().users.some((u) => u.mobile === "9000000002")).toBe(false);
  });
  it("login rejects wrong passwords with the same message for unknown accounts", async () => {
    const { POST } = await route("auth/login");
    const wrong = await call(POST, "POST", "/api/auth/login", { body: { identifier: ASHA, password: "Wrong#12345" } });
    const unknown = await call(POST, "POST", "/api/auth/login", { body: { identifier: "nobody@example.com", password: "Wrong#12345" } });
    expect(wrong.status).toBe(400);
    expect(wrong.body.message).toBe(unknown.body.message);
    const ok = await call(POST, "POST", "/api/auth/login", { body: { identifier: ASHA, password: "Demo@1234" } });
    expect(ok.status).toBe(200);
    expect(ok.headers.get("set-cookie")).toMatch(/HttpOnly/i);
    expect(ok.headers.get("set-cookie")).toMatch(/SameSite=lax/i);
    expect(JSON.stringify(ok.body)).not.toMatch(/passwordHash/);
  });
  it("login is rate limited", async () => {
    const { POST } = await route("auth/login");
    let last = 0;
    for (let i = 0; i < 30; i++) last = (await call(POST, "POST", "/api/auth/login", { body: { identifier: ASHA, password: "Wrong#12345" } })).status;
    expect(last).toBe(429);
  });
  it("/me needs a valid session; a forged token, or a token for a deleted account, is refused", async () => {
    const { GET } = await route("auth/me");
    const me = async () => (await call(GET, "GET", "/api/auth/me")).body.data.user;
    expect(await me()).toBeNull(); // not signed in: answers "nobody", never another person's data
    jar.token = "not.a.token";
    expect(await me()).toBeNull();
    await signIn(ASHA);
    expect((await me()).email).toBe(ASHA);
    expect(JSON.stringify(await me())).not.toMatch(/passwordHash/);
    db().users = db().users.filter((u) => u.email !== ASHA);
    expect(await me()).toBeNull();
  });
  it("a token whose role no longer matches the account is refused", async () => {
    await signIn(ASHA);
    db().users.find((u) => u.email === ASHA)!.role = "PHARMACIST";
    expect((await call((await route("orders")).GET, "GET", "/api/orders")).status).toBe(401);
  });
});

describe("RBAC on every protected route", () => {
  const matrix: { name: string; path: string; method: string; params?: Record<string, string>; body?: unknown; allowed: (string | undefined)[] }[] = [
    { name: "my orders", path: "orders", method: "GET", allowed: [ASHA] },
    { name: "pharmacy orders", path: "pharmacy/orders", method: "GET", allowed: [OWNER, PHARMACIST, OWNER2] },
    { name: "pharmacy inventory", path: "pharmacy/inventory", method: "GET", allowed: [OWNER, PHARMACIST, OWNER2] },
    { name: "pharmacy medicine requests", path: "pharmacy/medicine-requests", method: "GET", allowed: [OWNER, PHARMACIST, OWNER2] },
    { name: "rider deliveries", path: "rider/deliveries/available", method: "GET", allowed: [RIDER1, RIDER4] },
    { name: "admin dashboard", path: "admin/dashboard", method: "GET", allowed: [ADMIN] },
    { name: "admin pharmacies", path: "admin/pharmacies", method: "GET", allowed: [ADMIN] },
    { name: "admin orders", path: "admin/orders", method: "GET", allowed: [ADMIN] },
    { name: "admin users", path: "admin/users", method: "GET", allowed: [ADMIN] },
    { name: "admin riders", path: "admin/riders", method: "GET", allowed: [ADMIN] },
    { name: "admin service areas", path: "admin/service-areas", method: "GET", allowed: [ADMIN] },
    { name: "verify a pharmacy", path: "admin/pharmacies/[id]/verify", method: "POST", params: { id: "ph_5" }, body: { status: "VERIFIED" }, allowed: [ADMIN] },
  ];
  const everyone = [undefined, ASHA, OWNER, PHARMACIST, RIDER1, ADMIN];
  for (const m of matrix) {
    it(`${m.name}: only ${m.allowed.map((a) => a?.split("@")[0]).join("/")}`, async () => {
      const handler = (await route(m.path))[m.method];
      for (const who of everyone) {
        await signIn(who);
        const r = await call(handler, m.method, `/api/${m.path}`, { params: m.params, body: m.body });
        if (who && m.allowed.includes(who)) expect(r.status, `${who} should be allowed`).toBeLessThan(300);
        else expect(r.status, `${who ?? "anonymous"} must be refused`).toBe(who ? 403 : 401);
      }
    });
  }
  it("a customer cannot use pharmacy, rider or admin actions", async () => {
    await signIn(ASHA);
    const approve = await call((await route("pharmacy/orders/[id]/approve")).POST, "POST", "/x", { params: { id: "ord_4" }, body: {} });
    const pickup = await call((await route("rider/deliveries/[id]/pickup")).POST, "POST", "/x", { params: { id: "ord_6" }, body: { otp: "1234" } });
    const stock = await call((await route("pharmacy/inventory/[id]/stock")).PATCH, "PATCH", "/x", { params: { id: "inv_1" }, body: { stockQuantity: 999 } });
    expect([approve.status, pickup.status, stock.status]).toEqual([403, 403, 403]);
  });
  it("a rider cannot place or read customer orders, or review prescriptions", async () => {
    await signIn(RIDER1);
    expect((await call((await route("orders")).POST, "POST", "/x", { body: order })).status).toBe(403);
    expect((await call((await route("prescriptions/[id]/approve")).POST, "POST", "/x", { params: { id: "rx_2" }, body: {} })).status).toBe(403);
  });
});

describe("price and field tampering", () => {
  it("refuses a body that tries to send prices, totals, statuses or a role", async () => {
    await signIn(ASHA);
    const { POST } = await route("orders");
    for (const extra of [{ total: 1 }, { subtotal: 1 }, { unitPrice: 1 }, { status: "CONFIRMED" }, { paymentStatus: "PAID" }, { role: "SUPER_ADMIN" }, { deliveryFee: 0 }]) {
      const r = await call(POST, "POST", "/api/orders", { body: { ...order, ...extra } });
      expect(r.status, JSON.stringify(extra)).toBe(400);
    }
    const lineTamper = await call(POST, "POST", "/api/orders", { body: { ...order, items: [{ medicineId: MED.PARACETAMOL, quantity: 2, unitPrice: 0.01 }] } });
    expect(lineTamper.status).toBe(400);
    expect(db().orders.filter((o) => o.userId === "u_1" && o.createdAt > new Date(Date.now() - 5000).toISOString())).toHaveLength(0);
  });
  it("prices come from the pharmacy's inventory, not from the client", async () => {
    await signIn(ASHA);
    const r = await call((await route("orders")).POST, "POST", "/api/orders", { body: order });
    expect(r.status).toBe(201);
    const inv = db().inventory.find((i) => i.pharmacyId === "ph_1" && i.medicineId === MED.PARACETAMOL)!;
    expect(r.body.data.items[0].unitPrice).toBe(inv.sellingPrice);
    expect(r.body.data.subtotal).toBe(inv.sellingPrice * 2);
    expect(r.body.data.total).toBe(r.body.data.subtotal + r.body.data.deliveryFee - r.body.data.discount);
  });
  it("a customer cannot pick someone else's pharmacy address, family member or prescription", async () => {
    await signIn(ASHA);
    const { POST } = await route("orders");
    expect((await call(POST, "POST", "/api/orders", { body: { ...order, addressId: "ad_3" } })).status).toBe(400); // Rajesh's address
    expect((await call(POST, "POST", "/api/orders", { body: { ...order, familyMemberId: "fm_5" } })).status).toBe(400);
    expect((await call(POST, "POST", "/api/orders", { body: { ...order, items: [{ medicineId: MED.METFORMIN, quantity: 1 }], prescriptionId: "rx_2" } })).status).toBe(400);
  });
});

describe("ownership", () => {
  it("customers only see and cancel their own orders", async () => {
    await signIn(ASHA);
    const placed = await call((await route("orders")).POST, "POST", "/api/orders", { body: order });
    const id = placed.body.data.id;
    await signIn(RAJESH);
    expect((await call((await route("orders/[id]")).GET, "GET", "/x", { params: { id } })).status).toBe(403);
    expect((await call((await route("orders/[id]/cancel")).POST, "POST", "/x", { params: { id }, body: { reason: "mine now" } })).status).toBe(403);
    expect((await call((await route("orders")).GET, "GET", "/api/orders")).body.data.some((o: { id: string }) => o.id === id)).toBe(false);
    await signIn(ASHA);
    expect((await call((await route("orders/[id]/cancel")).POST, "POST", "/x", { params: { id }, body: { reason: "changed my mind" } })).status).toBe(200);
  });
  it("a pharmacy only works on its own orders, stock and requests", async () => {
    await signIn(ASHA);
    const placed = await call((await route("orders")).POST, "POST", "/api/orders", { body: order });
    const id = placed.body.data.id;
    await signIn(OWNER2); // Jan Seva: a different pharmacy
    expect((await call((await route("pharmacy/orders/[id]/approve")).POST, "POST", "/x", { params: { id }, body: {} })).status).toBe(403);
    expect((await call((await route("pharmacy/orders/[id]/reject")).POST, "POST", "/x", { params: { id }, body: { note: "not yours" } })).status).toBe(403);
    expect((await call((await route("pharmacy/orders")).GET, "GET", "/x")).body.data.some((o: { id: string }) => o.id === id)).toBe(false);
    const theirRow = db().inventory.find((i) => i.pharmacyId === "ph_1")!;
    expect((await call((await route("pharmacy/inventory/[id]/stock")).PATCH, "PATCH", "/x", { params: { id: theirRow.id }, body: { stockQuantity: 0 } })).status).toBe(403);
    await signIn(OWNER);
    expect((await call((await route("pharmacy/orders/[id]/approve")).POST, "POST", "/x", { params: { id }, body: {} })).status).toBe(200);
  });
  it("medicine requests belong to the person who made them", async () => {
    await signIn(RAJESH);
    const made = await call((await route("medicine-requests")).POST, "POST", "/api/medicine-requests", { body: { medicineQuery: "Rare tonic", mobile: "9876500002", pincode: "261001", quantity: 1 } });
    expect(made.status).toBe(200);
    const id = made.body.data.id;
    await signIn(ASHA);
    expect((await call((await route("medicine-requests/[id]")).GET, "GET", "/x", { params: { id } })).status).toBe(403);
    expect((await call((await route("medicine-requests/[id]")).DELETE, "DELETE", "/x", { params: { id } })).status).toBe(403);
  });
});

describe("prescription authorization", () => {
  const view = async (who: string | undefined, id: string) => { await signIn(who); return call((await route("prescriptions/[id]")).GET, "GET", "/x", { params: { id } }); };
  it("only the owner, the pharmacy handling it, and admins can open a prescription; the link is signed and never a public URL", async () => {
    const owner = await view(RAJESH, "rx_2");
    expect(owner.status).toBe(200);
    expect(owner.body.data.url).toMatch(/^\/api\/files\/.+[?&]sig=/);
    expect(JSON.stringify(owner.body)).not.toMatch(/fileKey/);
    expect((await view(PHARMACIST, "rx_2")).status).toBe(200);
    expect((await view(ADMIN, "rx_2")).status).toBe(200);
    expect((await view(ASHA, "rx_2")).status).toBe(403);   // another customer
    expect((await view(OWNER2, "rx_2")).status).toBe(403); // another pharmacy
    expect((await view(RIDER1, "rx_2")).status).toBe(403); // riders never
    expect((await view(undefined, "rx_2")).status).toBe(401);
  });
  it("only pharmacist / pharmacy admin / platform admin can approve or reject", async () => {
    const decide = async (who: string, kind: "approve" | "reject", id: string) => {
      await signIn(who);
      return call((await route(`prescriptions/[id]/${kind}`)).POST, "POST", "/x", { params: { id }, body: kind === "reject" ? { note: "Blurred, please resend" } : {} });
    };
    expect((await decide(RAJESH, "approve", "rx_2")).status).toBe(403);
    expect((await decide(RIDER1, "approve", "rx_2")).status).toBe(403);
    expect((await decide(OWNER2, "approve", "rx_2")).status).toBe(403); // not their pharmacy's order
    const ok = await decide(PHARMACIST, "approve", "rx_2");
    expect(ok.status).toBe(200);
    expect(db().orders.find((o) => o.prescriptionId === "rx_2")!.status).toBe("PRESCRIPTION_APPROVED");
    const rej = await decide(ADMIN, "reject", "rx_3");
    expect(rej.status).toBe(200);
    expect(db().prescriptions.find((p) => p.id === "rx_3")!.status).toBe("REJECTED");
  });
  it("the file link only works for the signed-in person it was issued to, and is never cached", async () => {
    const meta = await view(RAJESH, "rx_2");
    const url: string = meta.body.data.url;
    const key = url.split("/api/files/")[1].split("?")[0];
    const files = (await route("files/[key]")).GET;
    const open = async (u: string) => ({ status: (await files(new Request("http://localhost" + u), { params: Promise.resolve({ key }) })).status });
    expect((await open(url)).status).toBe(200);                          // the owner, with the link
    await signIn(ASHA);
    expect((await open(url)).status).toBe(403);                          // someone else with the same link
    await signIn(undefined);
    expect((await open(url)).status).toBe(403);                          // nobody signed in
    await signIn(RAJESH);
    expect((await open(url.replace(/sig=.{6}/, "sig=AAAAAA"))).status).toBe(403); // tampered signature
    const raw = await files(new Request("http://localhost" + url), { params: Promise.resolve({ key }) });
    expect(raw.headers.get("cache-control")).toMatch(/no-store/);
    expect(raw.headers.get("x-content-type-options")).toBe("nosniff");
  });
  it("uploads are validated: wrong type or content is refused", async () => {
    await signIn(ASHA);
    const form = new FormData();
    form.set("file", new File([new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])], "virus.png", { type: "image/png" }));
    form.set("consent", "true");
    const res = await (await route("prescriptions")).POST(new Request("http://localhost/api/prescriptions", { method: "POST", body: form }), { params: Promise.resolve({}) });
    expect(res.status).toBe(400);
    const exe = new FormData();
    exe.set("file", new File([new Uint8Array([0x4d, 0x5a, 0, 0])], "x.exe", { type: "application/x-msdownload" }));
    exe.set("consent", "true");
    expect((await (await route("prescriptions")).POST(new Request("http://localhost/api/prescriptions", { method: "POST", body: exe }), { params: Promise.resolve({}) })).status).toBe(400);
  });
});

describe("delivery: OTP protection and rider privacy", () => {
  async function readyOrder() {
    await signIn(ASHA);
    const placed = await call((await route("orders")).POST, "POST", "/api/orders", { body: order });
    const id = placed.body.data.id as string;
    await signIn(OWNER);
    for (const step of ["approve", "preparing", "ready"]) await call((await route(`pharmacy/orders/[id]/${step}`)).POST, "POST", "/x", { params: { id }, body: {} });
    await signIn(RIDER4);
    const accepted = await call((await route("rider/deliveries/[id]/accept")).POST, "POST", "/x", { params: { id } });
    expect(accepted.status).toBe(200);
    return { id, accepted };
  }
  it("stores only hashes, never the code, and hands neither code to the wrong person", async () => {
    const { id } = await readyOrder();
    const dl = deliveryOf(db().orders.find((o) => o.id === id)!)!;
    const pickup = codeFor(dl, "PICKUP");
    const drop = codeFor(dl, "DELIVERY");
    expect(dl.pickupOtpHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(dl)).not.toContain(pickup === drop ? "never" : `"${pickup}"`);
    expect(JSON.stringify(dl)).not.toMatch(new RegExp(`"(${pickup}|${drop})"`));
    // The rider's own view: no codes at all
    await signIn(RIDER4);
    const mine = await call((await route("delivery/active")).GET, "GET", "/x");
    expect(JSON.stringify(mine.body)).not.toMatch(/[Oo]tp/);
    // The pharmacy sees the pickup code only; the customer sees the delivery code only once it is on the way
    await signIn(OWNER);
    const ph = await call((await route("pharmacy/orders")).GET, "GET", "/x");
    expect(ph.body.data.find((o: { id: string }) => o.id === id).pickupOtp).toBe(pickup);
    expect(JSON.stringify(ph.body.data.find((o: { id: string }) => o.id === id))).not.toContain(`"${drop}"`);
    await signIn(ASHA);
    const cust = await call((await route("orders/[id]")).GET, "GET", "/x", { params: { id } });
    expect(cust.body.data.deliveryOtp).toBe(drop);
    expect(cust.body.data.pickupOtp).toBeUndefined();
    // Admin tables never include codes
    await signIn(ADMIN);
    const adm = await call((await route("admin/orders")).GET, "GET", "/x");
    expect(JSON.stringify(adm.body)).not.toMatch(/[Oo]tp/);
  });
  it("a wrong code is refused, five wrong codes lock the step, the right code works before that", async () => {
    const { id } = await readyOrder();
    const dl = deliveryOf(db().orders.find((o) => o.id === id)!)!;
    await signIn(RIDER4);
    const pickup = (await route("rider/deliveries/[id]/pickup")).POST;
    for (let i = 0; i < 4; i++) expect((await call(pickup, "POST", "/x", { params: { id }, body: { otp: "0000" } })).status).toBe(400);
    expect(dl.pickupAttempts).toBe(4);
    expect((await call(pickup, "POST", "/x", { params: { id }, body: { otp: codeFor(dl, "PICKUP") } })).status).toBe(200);
    expect(db().orders.find((o) => o.id === id)!.status).toBe("PICKED_UP");
    expect(deliveryOf(db().orders.find((o) => o.id === id)!)!.status).toBe("PICKED_UP");
  });
  it("brute force is stopped: after 5 wrong codes even the right one is refused", async () => {
    const { id } = await readyOrder();
    const dl = deliveryOf(db().orders.find((o) => o.id === id)!)!;
    await signIn(RIDER4);
    const pickup = (await route("rider/deliveries/[id]/pickup")).POST;
    for (let i = 0; i < 5; i++) await call(pickup, "POST", "/x", { params: { id }, body: { otp: "0000" } });
    const locked = await call(pickup, "POST", "/x", { params: { id }, body: { otp: codeFor(dl, "PICKUP") } });
    expect([409, 429]).toContain(locked.status);
    expect(db().orders.find((o) => o.id === id)!.status).toBe("RIDER_ASSIGNED");
  });
  it("full run with both codes, COD cash marked paid, delivery DELIVERED", async () => {
    const { id } = await readyOrder();
    const o = db().orders.find((x) => x.id === id)!;
    const dl = deliveryOf(o)!;
    await signIn(RIDER4);
    expect((await call((await route("rider/deliveries/[id]/arrived")).POST, "POST", "/x", { params: { id } })).status).toBe(200);
    expect(dl.status).toBe("AT_PHARMACY");
    await call((await route("rider/deliveries/[id]/pickup")).POST, "POST", "/x", { params: { id }, body: { otp: codeFor(dl, "PICKUP") } });
    expect((await call((await route("rider/deliveries/[id]/complete")).POST, "POST", "/x", { params: { id }, body: { otp: codeFor(dl, "DELIVERY") } })).status).toBe(409); // not started yet
    await call((await route("rider/deliveries/[id]/out-for-delivery")).POST, "POST", "/x", { params: { id } });
    expect(dl.status).toBe("OUT_FOR_DELIVERY");
    expect((await call((await route("rider/deliveries/[id]/complete")).POST, "POST", "/x", { params: { id }, body: { otp: codeFor(dl, "PICKUP") } })).status).toBe(400); // the other code
    expect((await call((await route("rider/deliveries/[id]/complete")).POST, "POST", "/x", { params: { id }, body: { otp: codeFor(dl, "DELIVERY") } })).status).toBe(200);
    expect(o.status).toBe("DELIVERED");
    expect(o.paymentStatus).toBe("PAID");
    expect(dl.status).toBe("DELIVERED");
  });
  it("another rider cannot act on someone else's delivery", async () => {
    const { id } = await readyOrder();
    await signIn(RIDER1);
    expect((await call((await route("rider/deliveries/[id]/pickup")).POST, "POST", "/x", { params: { id }, body: { otp: "1234" } })).status).toBe(403);
  });
  it("available jobs show no customer name, address or medicine", async () => {
    await signIn(ASHA);
    const placed = await call((await route("orders")).POST, "POST", "/api/orders", { body: order });
    await signIn(OWNER);
    for (const step of ["approve", "preparing", "ready"]) await call((await route(`pharmacy/orders/[id]/${step}`)).POST, "POST", "/x", { params: { id: placed.body.data.id }, body: {} });
    await signIn(RIDER4);
    const list = await call((await route("rider/deliveries/available")).GET, "GET", "/x");
    const text = JSON.stringify(list.body);
    expect(list.body.data.length).toBeGreaterThan(0);
    expect(text).not.toMatch(/Paracetamol|Asha|Blue gate|Hanuman|prescription|9876543210/i); // area + pincode only, no name, phone, house or landmark
  });
});
