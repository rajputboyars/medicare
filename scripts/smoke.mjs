// End-to-end smoke test against a running server: node scripts/smoke.mjs http://localhost:3100
// Uses the seeded demo accounts (password is a development-only test value).
const base = process.argv[2] ?? "http://localhost:3100";
const PW = "Demo@1234";
let failures = 0;
const ok = (name, cond, extra = "") => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? "  " + extra : ""}`);
  if (!cond) failures++;
};

async function login(identifier) {
  const r = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ identifier, password: PW }) });
  return { status: r.status, cookie: r.headers.get("set-cookie")?.split(";")[0] };
}
const call = async (cookie, method, path, body) => {
  const r = await fetch(base + path, { method, redirect: "manual", headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...(cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, ...j };
};
const png = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000001e221bc330000000049454e44ae426082", "hex");

const customer = await login("9876543210");
const customer2 = await login("rajesh@example.com");
const owner = await login("pharmacy@example.com");
const pharmacist = await login("pharmacist@example.com");
const owner2 = await login("pharmacy2@example.com");
const rider = await login("rider@example.com");
const rider4 = await login("rider4@example.com");
const admin = await login("admin@example.com");
ok("logins", [customer, customer2, owner, pharmacist, owner2, rider, rider4, admin].every((x) => x.status === 200 && x.cookie));
ok("bad password rejected", (await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ identifier: "9876543210", password: "wrong-pass" }) })).status === 400);

// ── RBAC ──
ok("anonymous cannot list orders", (await call(null, "GET", "/api/orders")).status === 401);
ok("customer cannot open pharmacy API", (await call(customer.cookie, "GET", "/api/pharmacy/dashboard")).status === 403);
ok("customer cannot open admin API", (await call(customer.cookie, "GET", "/api/admin/stats")).status === 403);
ok("customer cannot open rider API", (await call(customer.cookie, "GET", "/api/delivery/available")).status === 403);
ok("rider cannot read pharmacy orders", (await call(rider.cookie, "GET", "/api/pharmacy/orders")).status === 403);
ok("pharmacy cannot place customer orders", (await call(owner.cookie, "POST", "/api/orders", { pharmacyId: "ph_1", addressId: "ad_1", items: [{ medicineId: "med_7", quantity: 1 }], paymentMethod: "COD" })).status === 403);
ok("pharmacist cannot change admin settings", (await call(pharmacist.cookie, "PATCH", "/api/admin/settings", { commissionPercent: 1 })).status === 403);
ok("pharmacist cannot edit store settings (owner only)", (await call(pharmacist.cookie, "PATCH", "/api/pharmacy/settings", { priorityDelivery: false })).status === 403);
ok("proxy redirects customer away from /admin", (await fetch(`${base}/admin`, { redirect: "manual", headers: { cookie: customer.cookie } })).status >= 300);
const anon = await fetch(`${base}/pharmacy`, { redirect: "manual" });
ok("proxy redirects anonymous to /login", anon.status >= 300 && (anon.headers.get("location") ?? "").includes("/login"));
const removed = await Promise.all(["/doctors", "/labs", "/home-care", "/emergency", "/hospital", "/lab"].map((p) => fetch(base + p, { redirect: "manual" }).then((r) => r.status)));
ok("deferred modules are not exposed (Doctor / Lab / Home care / Hospital)", removed.every((s) => s === 404 || s >= 300));

// ── Location, search, finder ──
ok("covered pincode", (await call(null, "GET", "/api/coverage?pincode=261001")).data?.available === true);
ok("uncovered pincode says coming soon", ((await call(null, "GET", "/api/coverage?pincode=110001")).data?.message ?? "").includes("coming"));
ok("launch signup", (await call(null, "POST", "/api/launch-signup", { mobile: "9000000077", pincode: "110001" })).data?.ok === true);
const s = await call(null, "GET", "/api/medicines/search?q=paracetamol&pincode=261001");
ok("search finds paracetamol across pharmacies", s.data?.[0]?.pharmacyCount >= 2 && s.data[0].closest && s.data[0].fastest && s.data[0].lowest);
const ins = await call(null, "GET", "/api/medicines/med_20/availability?pincode=261001");
ok("pharmacy-specific availability (insulin only at one shop)", ins.data?.offers.length === 1 && ins.data.offers[0].pharmacyId === "ph_1");
const fm = await call(customer2.cookie, "POST", "/api/medicine-requests", { medicineQuery: "Liv-52 syrup", mobile: "9876500002", pincode: "261001" });
ok("Find This Medicine For Me creates a request", fm.status === 200 && fm.data?.pharmaciesNotified >= 2);
const preq = await call(owner.cookie, "GET", "/api/pharmacy/requests");
const mine = preq.data?.find((r) => r.id === fm.data.id);
ok("pharmacy sees the request", !!mine);
ok("pharmacy replies available → customer notified", (await call(owner.cookie, "POST", `/api/pharmacy/requests/${fm.data.id}`, { response: "AVAILABLE" })).data?.status === "FOUND");
const my = await call(customer2.cookie, "GET", "/api/medicine-requests");
ok("customer sees the replies (seeded out-of-stock + new available)", my.data?.find((r) => r.id === fm.data.id)?.responses?.some((x) => x.response === "AVAILABLE" && x.pharmacyName));

// ── Cart (server side) ──
ok("cart saved", (await call(customer.cookie, "PUT", "/api/cart", { pharmacyId: "ph_1", items: [{ medicineId: "med_7", quantity: 2 }] })).data?.lines?.length === 1);
ok("cart restored from server", (await call(customer.cookie, "GET", "/api/cart")).data?.lines?.[0]?.quantity === 2);

// ── Prescription required ──
const noRx = await call(customer.cookie, "POST", "/api/orders", { pharmacyId: "ph_1", addressId: "ad_1", items: [{ medicineId: "med_1", quantity: 1 }], paymentMethod: "COD", deliveryType: "NORMAL" });
ok("Rx medicine without prescription is refused", noRx.status === 400, noRx.error);

// ── OTC order, full state machine over HTTP ──
const placed = await call(customer.cookie, "POST", "/api/orders", { pharmacyId: "ph_1", addressId: "ad_1", items: [{ medicineId: "med_7", quantity: 2 }], paymentMethod: "COD", deliveryType: "NORMAL" });
ok("order placed → PENDING", placed.status === 200 && placed.data?.status === "PENDING", placed.error);
const id = placed.data.id;
ok("placing the order clears the server cart", (await call(customer.cookie, "GET", "/api/cart")).data?.lines?.length === 0);
ok("customer has no delivery OTP yet", placed.data.deliveryOtp === undefined);
ok("pharmacy cannot skip to READY", (await call(owner.cookie, "POST", `/api/pharmacy/orders/${id}`, { action: "step", step: "ready" })).status === 409);
ok("other pharmacy cannot touch it", (await call(owner2.cookie, "POST", `/api/pharmacy/orders/${id}`, { action: "step", step: "confirm" })).status === 403);
ok("→ CONFIRMED", (await call(pharmacist.cookie, "POST", `/api/pharmacy/orders/${id}`, { action: "step", step: "confirm" })).data?.status === "CONFIRMED");
ok("→ PREPARING", (await call(pharmacist.cookie, "POST", `/api/pharmacy/orders/${id}`, { action: "step", step: "prepare" })).data?.status === "PREPARING");
ok("→ READY_FOR_PICKUP", (await call(pharmacist.cookie, "POST", `/api/pharmacy/orders/${id}`, { action: "step", step: "ready" })).data?.status === "READY_FOR_PICKUP");
const avail = await call(rider4.cookie, "GET", "/api/delivery/available");
const job = avail.data?.find((j) => j.id === id);
ok("rider sees it in available deliveries", !!job);
ok("available list hides customer identity & medicines", !/Asha|9876543210|Hanuman|Paracetamol|prescription/i.test(JSON.stringify(job)));
ok("rider accepts → RIDER_ASSIGNED", (await call(rider4.cookie, "POST", `/api/delivery/orders/${id}`, { action: "accept" })).data?.status === "RIDER_ASSIGNED");
ok("second rider cannot take it", (await call(rider.cookie, "POST", `/api/delivery/orders/${id}`, { action: "accept" })).status === 409);
ok("it left the pool", !(await call(rider.cookie, "GET", "/api/delivery/available")).data?.some((j) => j.id === id));
const pOrders = await call(pharmacist.cookie, "GET", "/api/pharmacy/orders");
const pickup = pOrders.data.find((o) => o.id === id)?.pickupOtp;
ok("pharmacy sees pickup OTP", /^\d{4}$/.test(pickup ?? ""));
ok("wrong pickup OTP refused", (await call(rider4.cookie, "POST", `/api/delivery/orders/${id}`, { action: "pickup", otp: pickup === "0000" ? "1111" : "0000" })).status === 400);
ok("pickup → PICKED_UP", (await call(rider4.cookie, "POST", `/api/delivery/orders/${id}`, { action: "pickup", otp: pickup })).data?.status === "PICKED_UP");
ok("start → OUT_FOR_DELIVERY", (await call(rider4.cookie, "POST", `/api/delivery/orders/${id}`, { action: "start" })).data?.status === "OUT_FOR_DELIVERY");
const live = await call(customer.cookie, "GET", `/api/orders/${id}`);
ok("customer sees rider + delivery OTP", !!live.data?.rider && /^\d{4}$/.test(live.data?.deliveryOtp ?? ""));
ok("cannot cancel once on the way", (await call(customer.cookie, "POST", `/api/orders/${id}`, { action: "cancel", reason: "late" })).status === 409);
ok("wrong delivery OTP refused", (await call(rider4.cookie, "POST", `/api/delivery/orders/${id}`, { action: "deliver", otp: live.data.deliveryOtp === "0000" ? "1111" : "0000" })).status === 400);
ok("deliver with OTP → DELIVERED", (await call(rider4.cookie, "POST", `/api/delivery/orders/${id}`, { action: "deliver", otp: live.data.deliveryOtp })).data?.status === "DELIVERED");
const done = await call(customer.cookie, "GET", `/api/orders/${id}`);
ok("COD marked paid; history has every step", done.data?.paymentStatus === "PAID" && done.data.statusHistory.length === 8);
const hist = await call(rider4.cookie, "GET", "/api/delivery/history");
ok("rider history + earnings updated", hist.data?.[0]?.orderCode === done.data.code && (await call(rider4.cookie, "GET", "/api/delivery/earnings")).data?.today?.count >= 1);

// ── Reorder ──
const re = await call(customer.cookie, "POST", `/api/orders/${id}`, { action: "repeat" });
ok("one-click reorder creates a new order", re.status === 200 && re.data?.isRepeat === true && re.data.id !== id);
ok("customer can save the delivered order's medicines", (await call(customer.cookie, "POST", `/api/orders/${id}`, { action: "save_medicines", everyDays: 30 })).data?.items?.length === 1);

// ── Prescription workflow ──
const fd = new FormData();
fd.set("file", new File([png], "rx.png", { type: "image/png" }));
fd.set("consent", "true");
fd.set("requestedMedicines", "Metformin 500");
const up = await fetch(`${base}/api/prescriptions`, { method: "POST", headers: { cookie: customer.cookie }, body: fd }).then((r) => r.json());
ok("prescription uploaded", !!up.data?.id, up.error);
const evil = new FormData();
evil.set("file", new File([Buffer.from([0x4d, 0x5a, 0x90, 0x00, 1, 2, 3])], "x.png", { type: "image/png" }));
evil.set("consent", "true");
ok("fake image rejected", (await fetch(`${base}/api/prescriptions`, { method: "POST", headers: { cookie: customer.cookie }, body: evil })).status === 400);
const meta = await call(customer.cookie, "GET", `/api/prescriptions/${up.data.id}`);
ok("signed URL issued, no file key leaked", /^\/api\/files\//.test(meta.data?.url ?? "") && meta.data.fileKey === undefined);
ok("owner can open private file (no-store)", await fetch(base + meta.data.url, { headers: { cookie: customer.cookie } }).then((r) => r.status === 200 && (r.headers.get("cache-control") ?? "").includes("no-store")));
ok("link without session refused", (await fetch(base + meta.data.url)).status === 403);
ok("link in a rider's session refused", (await fetch(base + meta.data.url, { headers: { cookie: rider.cookie } })).status === 403);
ok("tampered signature refused", (await fetch(base + meta.data.url.replace(/sig=./, "sig=x"), { headers: { cookie: customer.cookie } })).status === 403);
ok("rider cannot request prescription metadata", (await call(rider.cookie, "GET", `/api/prescriptions/${up.data.id}`)).status === 403);

const rx = await call(customer.cookie, "POST", "/api/orders", { pharmacyId: "ph_1", addressId: "ad_1", items: [{ medicineId: "med_1", quantity: 2 }], prescriptionId: up.data.id, paymentMethod: "UPI", deliveryType: "NORMAL" });
ok("Rx order → PRESCRIPTION_REVIEW", rx.data?.status === "PRESCRIPTION_REVIEW", rx.error);
const q = await call(pharmacist.cookie, "GET", "/api/pharmacy/prescriptions");
ok("order appears in the verification queue", q.data?.orders?.some((o) => o.orderId === rx.data.id) && q.data.callbacks.length >= 1);
ok("pharmacist cannot confirm before review", (await call(pharmacist.cookie, "POST", `/api/pharmacy/orders/${rx.data.id}`, { action: "step", step: "confirm" })).status === 409);
ok("pharmacy can open the prescription", (await fetch(base + (await call(pharmacist.cookie, "GET", `/api/prescriptions/${up.data.id}`)).data.url, { headers: { cookie: pharmacist.cookie } })).status === 200);
ok("reject without a reason refused", (await call(pharmacist.cookie, "POST", `/api/pharmacy/orders/${rx.data.id}`, { action: "review", decision: "REJECT" })).status === 400);
ok("clarification request keeps order in review", (await call(pharmacist.cookie, "POST", `/api/pharmacy/orders/${rx.data.id}`, { action: "review", decision: "CLARIFY", note: "Signature is cut off" })).data?.status === "PRESCRIPTION_REVIEW");
ok("approve → PRESCRIPTION_APPROVED", (await call(pharmacist.cookie, "POST", `/api/pharmacy/orders/${rx.data.id}`, { action: "review", decision: "APPROVE" })).data?.status === "PRESCRIPTION_APPROVED");
ok("confirm → CONFIRMED", (await call(pharmacist.cookie, "POST", `/api/pharmacy/orders/${rx.data.id}`, { action: "step", step: "confirm" })).data?.status === "CONFIRMED");
ok("UPI payment captured", (await call(customer.cookie, "POST", `/api/orders/${rx.data.id}`, { action: "pay", providerRef: "demo_123" })).data?.paymentStatus === "PAID");
ok("customer cancels before pickup → refunded", (await call(customer.cookie, "POST", `/api/orders/${rx.data.id}`, { action: "cancel", reason: "Changed my mind" })).data?.paymentStatus === "REFUNDED");

// ── Admin ──
const stats = await call(admin.cookie, "GET", "/api/admin/stats");
ok("admin stats", stats.data?.activePharmacies >= 4 && stats.data?.customers === 5);
ok("admin can verify pharmacy", (await call(admin.cookie, "PATCH", "/api/admin/partners/pharmacies/ph_5", { status: "VERIFIED" })).data?.verification === "VERIFIED");
ok("admin can verify rider", (await call(admin.cookie, "PATCH", "/api/admin/partners/riders/dp_5", { status: "VERIFIED" })).data?.verification === "VERIFIED");
const gen = await call(admin.cookie, "POST", "/api/admin/settlements", {});
ok("settlements generated for delivered orders", gen.data?.created >= 1 && gen.data.settlements.every((x) => x.net === x.gross - x.commission));
ok("reports available", (await call(admin.cookie, "GET", "/api/admin/reports")).data?.days?.length === 7);
ok("settings editable", (await call(admin.cookie, "PATCH", "/api/admin/settings", { commissionPercent: 9 })).data?.commissionPercent === 9);
const aud = await call(admin.cookie, "GET", "/api/admin/list/audit");
ok("audit log recorded sensitive actions", ["PRESCRIPTION_APPROVE", "VERIFICATION_VERIFIED", "ORDER_CONFIRMED", "SETTLEMENTS_GENERATED"].every((a) => aud.data?.some((x) => x.action === a)));
const leak = JSON.stringify([await call(admin.cookie, "GET", "/api/admin/list/orders"), await call(admin.cookie, "GET", "/api/admin/list/customers")]);
ok("admin tables leak no OTPs / secrets", !/deliveryOtp|pickupOtp|fileKey|passwordHash/.test(leak));
ok("pharmacy customers list masks phones", (await call(owner.cookie, "GET", "/api/pharmacy/customers")).data?.every((c) => /••/.test(c.mobile)));
ok("pharmacy payments + reports", (await call(owner.cookie, "GET", "/api/pharmacy/payments")).data?.totals && (await call(owner.cookie, "GET", "/api/pharmacy/reports")).data?.days?.length === 7);

// ── Rate limit ──
let limited = false;
for (let i = 0; i < 12; i++) {
  const r = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ identifier: "brute@example.com", password: "nope-nope" }) });
  if (r.status === 429) { limited = true; break; }
}
ok("login brute force is rate limited", limited);

console.log(failures ? `\n${failures} FAILED` : "\nAll smoke checks passed");
process.exit(failures ? 1 : 0);
