# DawaDost backend architecture (V1)

Next.js App Router · TypeScript · MongoDB (Mongoose) · Zod · JWT cookie sessions · capability-based RBAC.

## Code layout (feature-based)

```
src/server/
  core/            guards.ts · pagination.ts · response.ts     reusable: auth/role/ownership guards, paginate(), envelope helpers
  http.ts          the one import for routes: handle(), parseBody(), parseQuery(), limit(), requireUser(), requireRole(), paginate()
  tx.ts            atomically(collections, fn)                  all-or-nothing unit of work (rolls back on throw)
  store.ts · seed.ts · persistence.ts · mongo.ts · errors.ts    working set, demo data, MongoDB write-back, error types
  features/
    accounts/          users, family members, addresses, sessions
    medicines/         catalogue search and pharmacy-specific availability (finder)
    inventory/         stock.ts: reserve / consume / release / restock
    orders/            checkout, state machine, status ledger, pharmacy-side actions
    prescriptions/     private files, upload validation, access rules
    medicine-requests/ "Find My Medicine", cart, saved medicines, repeat orders
    delivery/          rider jobs, OTP (otp.ts), earnings
    payments/          provider-independent adapters (COD, MOCK, ready for Razorpay)
    notifications/     notify() channels
    pharmacy/          inventory management, dashboard, finance, reports
    service-areas/     rollout rules (state / district / town / pincode)
    admin/             verification, settlements, attention list, admin tables
src/app/api/**/route.ts   thin handlers: guard → validate (Zod) → call a feature service → return data
src/lib/              types, validation (Zod), rbac, order-machine, pricing, auth, signed-url, file-validation
src/models/index.ts   Mongoose schemas + indexes
```

**Rule of thumb:** routes never contain business rules; features never import from routes; every database access in a feature goes through `db()` so a repository layer can replace it later.

### How requests reach MongoDB
Services work on an in-process working set (`db()`), which is loaded from MongoDB at server start (`DATA_SOURCE=mongo`) and written back after every mutating request (`handle()` → `flush()`, a per-document diff with `bulkWrite`). Each service function is synchronous, so inside one Node process two requests can never interleave between "check stock" and "reserve stock". With `MONGO_TRANSACTIONS=true` (replica set / Atlas) each request is written in **one MongoDB transaction**.
*This assumes one server instance.* Scaling out means turning the services into async repositories that use `session.withTransaction` and conditional updates (`$inc` with a `stockQuantity - reservedQuantity >= n` filter); `atomically()` already has that call shape.

## API response shape

```json
{ "success": true, "data": {}, "message": "Order placed", "errors": null, "meta": null }
{ "success": false, "data": null, "message": "…", "errors": [{ "code": "INVALID_FIELD", "field": "mobile", "message": "…" }], "meta": null }
```
List endpoints return `data: []` and `meta: { page, limit, total, totalPages, hasNext, sort }`. Query options: `?page=&limit=` (max 100) `&sort=field:asc|desc` `&q=` and per-endpoint filters (`?status=PENDING,CONFIRMED`). Unknown sort fields or oversized limits give `400`. Error codes: `UNAUTHENTICATED` 401 · `FORBIDDEN` 403 · `NOT_FOUND` 404 · `CONFLICT` 409 · `RATE_LIMITED` 429 · `INVALID_FIELD`/`BAD_REQUEST` 400 · `INTERNAL_ERROR` 500 (never leaks internals).

## Database schema

| Collection | Key fields | Notes |
|---|---|---|
| **User** | name, mobile (unique), email (unique, sparse), `passwordHash` (bcrypt, `select:false`), role, partnerId, consent | partnerId links staff to a pharmacy or a rider profile |
| **FamilyMember** | userId, name, age, gender, relationship, allergies | the patient on orders, prescriptions and requests |
| **Address** | userId, pincode, state, district, town, area, **landmark**, houseDescription, location | orders keep a *copy* (snapshot) |
| **Medicine** | name, generic, brand, strength, form, mrp, prescriptionRequired, restricted | **master product data only**: no stock, no pharmacy price |
| **Pharmacy** | drugLicense (unique), verification, servicePincodes, location (+2dsphere), acceptingOrders | |
| **PharmacyInventory** | pharmacyId, medicineId, batch, expiry, mrp, sellingPrice, **stockQuantity**, **reservedQuantity**, lowStockThreshold, **lastUpdatedAt** | one row per pharmacy + medicine + batch; `availableQuantity = stockQuantity − reservedQuantity` |
| **Prescription** | userId, familyMemberId, `fileKey` (private, `select:false`), status, reviewedBy/At, expiresAt | status `UPLOADED → UNDER_REVIEW → APPROVED / REJECTED / EXPIRED` (+ `NEEDS_CLARIFICATION` holding state) |
| **Cart** | userId (unique), pharmacyId, items | one pharmacy per cart |
| **Order** (+ **OrderItem**) | code, userId, pharmacyId, status, **addressSnapshot**, items (**name, strength, mrp, unitPrice snapshots**), subtotal/fee/discount/total, payment method + status, `stockAllocations`, `stockState`, `paymentExpiresAt` | all prices computed server-side |
| **OrderStatusHistory** | orderId, fromStatus, toStatus, changedBy, actorRole, note, timestamp | append-only; one row per transition |
| **MedicineRequest** | userId, familyMemberId (patient), medicineQuery/Id, strength, quantity, prescriptionId, photoRxId, serviceAreaId, status, expiresAt | `SEARCHING / FOUND / NOT_FOUND / EXPIRED / CANCELLED` |
| **MedicineRequestResponse** | requestId + pharmacyId (unique), response, price, availableQty, prepMinutes, alternative | `AVAILABLE / CAN_ARRANGE / NOT_AVAILABLE / ALTERNATIVE_AVAILABLE` |
| **DeliveryPartner** | name, vehicle, verification, available, location | rider status `OFFLINE / AVAILABLE / BUSY / SUSPENDED` is derived from verification + online switch + active jobs |
| **Delivery** | orderId, partnerId, status, payout, cashToCollect, `pickupOtpHash`, `deliveryOtpHash`, `otpNonce` (all `select:false`), attempt counters, timestamps | `WAITING_FOR_RIDER → ASSIGNED → AT_PHARMACY → PICKED_UP → OUT_FOR_DELIVERY → DELIVERED` or `FAILED` |
| **Payment** | orderId (unique), method, provider, amount, refundedAmount, status, providerRef, paidAt | `PENDING / AUTHORIZED / PAID / FAILED / REFUNDED / PARTIALLY_REFUNDED` |
| **Settlement** | partnerType, partnerId, period, gross, commission, net, status | |
| **ServiceArea** | level (STATE/DISTRICT/TOWN/PINCODE), name, state, district, town, pincode, status | `ACTIVE / COMING_SOON / DISABLED` |
| **Notification**, **SupportTicket**, **AuditLog**, SavedMedicine, Review, Offer, PlatformSettings, StoredFile | | |

### Relations
```
User 1─* FamilyMember · Address · Prescription · Cart(1) · Order · MedicineRequest · SupportTicket · Notification
Pharmacy 1─* PharmacyInventory *─1 Medicine           (availability is per pharmacy)
Pharmacy 1─* Order ─* OrderItem(snapshot of Medicine+price) · 1─* OrderStatusHistory · 1─1 Payment · 1─0..1 Delivery *─0..1 DeliveryPartner
Order *─0..1 Prescription · Order ─* StockAllocation → PharmacyInventory batch
MedicineRequest 1─* MedicineRequestResponse *─1 Pharmacy · MedicineRequest ─0..1 Prescription/photo · ─0..1 ServiceArea
Settlement *─1 Pharmacy | DeliveryPartner · Order *─0..1 Settlement
```

### Indexes (high-frequency queries)
Medicine text(name, generic, brand) · Pharmacy (servicePincodes, verification, acceptingOrders) + 2dsphere · Inventory unique (pharmacy, medicine, batch), (medicine, stock, pharmacy), (pharmacy, stock) · Order unique code, (userId, createdAt), (pharmacyId, status, createdAt), (status, createdAt), (deliveryPartnerId, status), sparse (paymentExpiresAt) · OrderStatusHistory (orderId, timestamp) · Delivery (status, createdAt) for the rider pool, (partnerId, status) · MedicineRequest (pincode, status, createdAt), (status, expiresAt), (userId, createdAt) · Response unique (requestId, pharmacyId) · Payment unique orderId · ServiceArea unique (level, name), status, pincode · User unique mobile and email.

## Order state machine

```
 Non-Rx : PENDING ───────────────────────────────▶ CONFIRMED
 Rx     : PRESCRIPTION_REVIEW ▶ PRESCRIPTION_APPROVED ▶ CONFIRMED
 then   : CONFIRMED ▶ PREPARING ▶ READY_FOR_PICKUP ▶ RIDER_ASSIGNED ▶ PICKED_UP ▶ OUT_FOR_DELIVERY ▶ DELIVERED
 RIDER_ASSIGNED ▶ READY_FOR_PICKUP        (rider drops the job; same one-time codes)
 CANCELLED : from any state before PICKED_UP by the customer / pharmacy / admin;
             from PICKED_UP and OUT_FOR_DELIVERY by admin only;
             SYSTEM cancels unpaid online orders (PENDING / review states) after 30 minutes.
 DELIVERED and CANCELLED are final.
```
Every status change goes through `transition(order, to, actor, note)`, which (1) checks `canTransition(from, to, actorRole)` against the table in `src/lib/order-machine.ts`, (2) runs the side effects for the move, (3) appends an **OrderStatusHistory** row. A refused move changes and writes nothing. Tests walk every (from, to, actor) triple.

## Inventory reservation

`availableQuantity = stockQuantity − reservedQuantity`. Allocation is FEFO (earliest expiry first); expired and zero-available batches are never sold.

| Event | Effect on the batches recorded in `order.stockAllocations` | `order.stockState` |
|---|---|---|
| Checkout | `reservedQuantity += n` (shelf count unchanged) | `RESERVED` |
| Pharmacy confirms | `stockQuantity −= n`, `reservedQuantity −= n` | `CONSUMED` |
| Cancel / reject / payment expired **before** confirm | `reservedQuantity −= n` | `RELEASED` |
| Cancel **after** confirm | `stockQuantity += n` | `RELEASED` |

Releasing or restocking always uses the same batches that were reserved. A second cancel cannot double-release. A pharmacy can't set stock below `reservedQuantity`. **Race safety:** check-and-reserve is one synchronous step; checkout runs inside `atomically()` so any failure rolls back reservations, order, payment and history together. A 60-second sweeper (`instrumentation.ts`) cancels unpaid online orders and closes stale searches.

## Checkout (in this order)
1. address belongs to the caller · 2. **service area** live for that address (most specific rule wins; `COMING_SOON`/`DISABLED`/unknown fail with a friendly message) · 3. pharmacy exists, `VERIFIED`, accepting orders, serves the pincode · 4. medicines exist · 5. stock available · 6. prescription rules (required, owned, not rejected, not expired; restricted medicines need an *already approved* prescription) · 7. prices and totals computed server-side from inventory + settings (the body is `strict`: sending `total`, `unitPrice`, `status`, `paymentStatus`, `role` is a 400) · 8. reserve stock · 9. create order + snapshots + first history row · 10. create the payment record.

## RBAC matrix
Capabilities live in `src/lib/rbac.ts`; handlers ask `requireUser("capability")`. A session token is re-checked against the user record on every request (deleted or re-roled accounts are refused).

| Capability | CUSTOMER | PHARMACIST | PHARMACY_ADMIN | DELIVERY_PARTNER | SUPER_ADMIN |
|---|:-:|:-:|:-:|:-:|:-:|
| `order:create` (cart, checkout, own orders) | ✔ | | | | |
| `order:read:pharmacy`, `order:fulfil` | | ✔ | ✔ | | |
| `prescription:review` | | ✔ | ✔ | | ✔ |
| `inventory:manage`, medicine-request replies | | ✔ | ✔ | | |
| `pharmacy:manage`, `pharmacy:finance` | | | ✔ | | |
| `delivery:execute` (rider routes) | | | | ✔ | |
| `admin:read`, `admin:write` | | | | | ✔ |

Beyond the role, **ownership** is enforced: customers touch only their own orders, prescriptions, requests, addresses; pharmacy staff only their pharmacy's orders, stock and requests; riders only their assigned deliveries.

## API list
Generated from the route files. "signed-in user, or public" means the route calls `requireUser()`/`currentUser()` without a capability, or is on the reviewed public list in `tests/route-guards.test.ts`.

| Methods | Path | Capability |
|---|---|---|
| GET POST | `/api/addresses` | signed-in user, or public (see route) |
| DELETE | `/api/addresses/[id]` | signed-in user, or public (see route) |
| GET | `/api/admin/dashboard` | admin:read |
| GET | `/api/admin/list/[entity]` | admin:read |
| GET | `/api/admin/orders` | admin:read |
| GET | `/api/admin/partners/[kind]` | admin:read |
| PATCH | `/api/admin/partners/[kind]/[id]` | admin:write |
| GET | `/api/admin/pharmacies` | admin:read |
| POST | `/api/admin/pharmacies/[id]/verify` | admin:write |
| GET | `/api/admin/reports` | admin:read |
| GET | `/api/admin/riders` | admin:read |
| GET POST | `/api/admin/service-areas` | admin:read, admin:write |
| PATCH | `/api/admin/service-areas/[id]` | admin:write |
| GET PATCH | `/api/admin/settings` | admin:read, admin:write |
| POST | `/api/admin/settlements` | admin:write |
| PATCH | `/api/admin/settlements/[id]` | admin:write |
| GET | `/api/admin/stats` | admin:read |
| PATCH | `/api/admin/tickets/[id]` | admin:write |
| GET | `/api/admin/users` | admin:read |
| POST | `/api/auth/login` | signed-in user, or public (see route) |
| POST | `/api/auth/logout` | signed-in user, or public (see route) |
| GET | `/api/auth/me` | signed-in user, or public (see route) |
| POST | `/api/auth/register` | signed-in user, or public (see route) |
| GET PUT | `/api/cart` | order:create |
| POST | `/api/cart/items` | order:create |
| PATCH DELETE | `/api/cart/items/[id]` | order:create |
| GET | `/api/coverage` | signed-in user, or public (see route) |
| GET | `/api/delivery/active` | delivery:execute |
| GET | `/api/delivery/available` | delivery:execute |
| GET | `/api/delivery/earnings` | delivery:execute |
| GET | `/api/delivery/history` | delivery:execute |
| GET PATCH | `/api/delivery/me` | delivery:execute |
| POST | `/api/delivery/orders/[id]` | delivery:execute |
| GET POST | `/api/family` | signed-in user, or public (see route) |
| PUT DELETE | `/api/family/[id]` | signed-in user, or public (see route) |
| GET | `/api/files/[key]` | signed-in user, or public (see route) |
| POST | `/api/launch-signup` | signed-in user, or public (see route) |
| PATCH | `/api/me` | signed-in user, or public (see route) |
| GET | `/api/me/export` | signed-in user, or public (see route) |
| GET POST | `/api/medicine-requests` | signed-in user, or public (see route) |
| GET DELETE | `/api/medicine-requests/[id]` | signed-in user, or public (see route) |
| GET | `/api/medicines/[id]` | signed-in user, or public (see route) |
| GET | `/api/medicines/[id]/availability` | signed-in user, or public (see route) |
| GET | `/api/medicines/meta` | signed-in user, or public (see route) |
| GET | `/api/medicines/search` | signed-in user, or public (see route) |
| GET | `/api/notifications` | signed-in user, or public (see route) |
| GET | `/api/offers` | signed-in user, or public (see route) |
| GET POST | `/api/orders` | order:create |
| GET POST | `/api/orders/[id]` | order:create |
| POST | `/api/orders/[id]/cancel` | order:create |
| POST | `/api/orders/quote` | order:create |
| POST | `/api/partners/pharmacy` | signed-in user, or public (see route) |
| POST | `/api/partners/rider` | signed-in user, or public (see route) |
| GET | `/api/pharmacies/nearby` | signed-in user, or public (see route) |
| GET | `/api/pharmacy/customers` | inventory:manage |
| GET | `/api/pharmacy/dashboard` | inventory:manage |
| GET POST | `/api/pharmacy/inventory` | inventory:manage |
| PATCH PUT | `/api/pharmacy/inventory/[id]` | inventory:manage |
| PATCH | `/api/pharmacy/inventory/[id]/stock` | inventory:manage |
| POST | `/api/pharmacy/inventory/bulk` | inventory:manage |
| GET | `/api/pharmacy/medicine-requests` | inventory:manage |
| POST | `/api/pharmacy/medicine-requests/[id]/respond` | inventory:manage |
| GET | `/api/pharmacy/orders` | order:read:pharmacy |
| POST | `/api/pharmacy/orders/[id]` | order:fulfil |
| POST | `/api/pharmacy/orders/[id]/approve` | order:fulfil |
| POST | `/api/pharmacy/orders/[id]/preparing` | order:fulfil |
| POST | `/api/pharmacy/orders/[id]/ready` | order:fulfil |
| POST | `/api/pharmacy/orders/[id]/reject` | order:fulfil |
| GET | `/api/pharmacy/payments` | inventory:manage |
| GET | `/api/pharmacy/prescriptions` | prescription:review |
| POST | `/api/pharmacy/prescriptions/[id]` | prescription:review |
| GET | `/api/pharmacy/reports` | inventory:manage |
| GET | `/api/pharmacy/requests` | inventory:manage |
| POST | `/api/pharmacy/requests/[id]` | inventory:manage |
| GET PATCH | `/api/pharmacy/settings` | inventory:manage, pharmacy:manage |
| GET POST | `/api/prescriptions` | order:create |
| GET | `/api/prescriptions/[id]` | signed-in user, or public (see route) |
| POST | `/api/prescriptions/[id]/approve` | prescription:review |
| POST | `/api/prescriptions/[id]/reject` | prescription:review |
| POST | `/api/quick-order` | signed-in user, or public (see route) |
| POST | `/api/rider/deliveries/[id]/accept` | delivery:execute |
| POST | `/api/rider/deliveries/[id]/arrived` | delivery:execute |
| POST | `/api/rider/deliveries/[id]/complete` | delivery:execute |
| POST | `/api/rider/deliveries/[id]/out-for-delivery` | delivery:execute |
| POST | `/api/rider/deliveries/[id]/pickup` | delivery:execute |
| GET | `/api/rider/deliveries/available` | delivery:execute |
| GET POST | `/api/saved` | order:create |
| POST DELETE | `/api/saved/[id]` | order:create |
| GET POST | `/api/support` | signed-in user, or public (see route) |

## Security protections
- **Passwords** bcrypt-hashed; hashes are `select:false` in Mongo and never serialised. Same message for unknown account and wrong password; login/register rate limited.
- **Sessions** HS256 JWT in an `HttpOnly`, `SameSite=Lax`, `Secure` (production) cookie; secret required in production; role and account re-validated each request.
- **Validation** every body and query goes through Zod on the server; order and signup bodies are `strict` so extra fields are refused instead of ignored.
- **No trust in the client** for price, pharmacy eligibility, role, payment status or order status.
- **Prescription files** stored under opaque keys in private storage, never public. Access = owner, the pharmacy handling it (via order or shared request), or admin. Files are served only through `/api/files/[key]`, which needs a valid HMAC signature **and** the same signed-in user **and** current access rights; `no-store`, `nosniff`, restrictive CSP. Uploads are checked by type, size and magic bytes. Viewing someone else's prescription is audit-logged.
- **Riders** receive no medicine names, prescription or patient details; before accepting they see only area, distance and payout.
- **OTPs** never stored: only a keyed HMAC hash + nonce per delivery; the code shown to the pharmacy/customer is re-derived with the server secret. Constant-time compare, per-IP/user throttle, and lock after 5 wrong tries per delivery.
- **Audit log** for prescription decisions, order rejections/cancellations, verification, settings, stock edits, service-area changes, failed OTPs.
- **Rate limiting** `limit(bucket, max, window, key)` (in-memory; swap for Redis via `REDIS_URL`).
- **Structural test** guarantees every API route has a guard or is on the reviewed public list.

## Tests
`npm test` runs: `tests/workflow.test.ts` (end-to-end service behaviour), `tests/domain.test.ts` (reservation, state machine, ledger, service areas, requests, cart, payments), `tests/api.test.ts` (real route handlers: envelope, pagination, authentication, RBAC matrix, ownership, tampering, prescription access, OTPs), `tests/route-guards.test.ts`, `tests/persistence.test.ts` (MongoDB round-trip; needs a local MongoDB), `tests/lib.test.ts`. `npm run smoke` runs the same flows over HTTP against a running server.

## Remaining production integrations
Payment gateway (Razorpay adapter + signed webhooks + real refunds, `AUTHORIZED` flow) · SMS/WhatsApp/push/email providers behind `notify()` · object storage (S3/GCS) with malware scanning for prescription files, instead of bytes in MongoDB · Redis rate limiter and shared cache · async repositories + MongoDB transactions + conditional `$inc` reservations for multi-instance deployment · queue/cron for the sweeper (expiry, refill reminders) · OTP delivery by SMS instead of showing codes in-app · live rider location · CSRF token / `Origin` check for cookie-authenticated mutations behind a different domain · password reset and mobile OTP login · monitoring, backups, secrets manager.
