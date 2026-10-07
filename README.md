# DawaDost (दवा दोस्त): V1 medicine delivery

Medicines delivered locally for small towns. Customer app, pharmacy dashboard, admin dashboard and a rider PWA.
Next.js 16 (App Router) · TypeScript · Tailwind v4 · React Query · Zustand · React Hook Form + Zod · Mongoose / MongoDB · JWT sessions (jose).

Doctor, lab, hospital and home-healthcare modules are intentionally **not** in V1 (a backup of the earlier prototype is kept outside the repo).

## Run it

```bash
npm install
npm run db:up        # MongoDB in Docker (docker-compose.yml)
cp .env.example .env.local
npm run dev          # http://localhost:3000   (first start seeds MongoDB)
npm run db:reset     # wipe + reseed the demo data any time
```

`DATA_SOURCE=mock` in `.env.local` runs without MongoDB (in-memory demo data).

Demo accounts (development only, password `Demo@1234`): customers `9876543210` (Asha, family of 4), `rajesh@` / `priya@` / `salim@` / `sunita@example.com` ·
pharmacy owner `pharmacy@example.com`, pharmacist `pharmacist@example.com`, second pharmacy `pharmacy2@example.com` ·
riders `rider@`, `rider2@` … `rider5@example.com` (rider5 is awaiting verification) · admin `admin@example.com`.

Checks: `npm run typecheck && npm run lint && npm test` · `npm run smoke` (79 HTTP checks against a running server).

## Brand

**DawaDost** (*dawa* = medicine, *dost* = friend). Mark: a map pin with a medical cross, i.e. a verified pharmacy near you, with an amber "delivery" shadow. Guide, colours and usage rules: [docs/brand.md](docs/brand.md).
Master files are in `public/brand/*.svg` and `public/favicon.svg`; `npm run brand` renders every PNG icon, `favicon.ico` (16/32/48), the logo PNGs and the OG image with a local Chrome. React component: `src/components/brand/logo.tsx`.

## PWA

Two installable apps from one codebase: **DawaDost** (customers, scope `/`) and **DawaDost Rider** (`/delivery`, own manifest at `/rider.webmanifest`, own icon and theme colour).
Maskable + Apple touch icons (`npm run brand` regenerates them), install card on Profile and the rider home (Android prompt; "Add to Home Screen" steps on iOS), offline banner, and a service worker that precaches the offline page, caches static assets, and **never caches `/api` or prescription files**.
The service worker registers in production builds only (set `NEXT_PUBLIC_SW_DEV=1` to test it in dev). Ordering always needs a connection so stock and prescription rules are enforced; the cart is kept on the phone while offline.
Verified in headless Chrome: no manifest or installability errors, worker activates, offline navigation shows the offline page.

## Roles

`CUSTOMER`, `PHARMACY_ADMIN`, `PHARMACIST`, `DELIVERY_PARTNER`, `SUPER_ADMIN`. Capability-based RBAC (`src/lib/rbac.ts`), enforced in `proxy.ts` for pages and again in every API handler.

## Order state machine (`src/lib/order-machine.ts`)

```
non-Rx : PENDING ───────────────────────────────▶ CONFIRMED
Rx     : PRESCRIPTION_REVIEW ▶ PRESCRIPTION_APPROVED ▶ CONFIRMED
then   : ▶ PREPARING ▶ READY_FOR_PICKUP ▶ RIDER_ASSIGNED ▶ PICKED_UP ▶ OUT_FOR_DELIVERY ▶ DELIVERED
any non-final state ▶ CANCELLED   (customer until pickup; pharmacy until pickup; admin any time before delivery)
```

All status changes go through one `transition()` function. Side effects: stock is reserved FEFO at CONFIRMED and returned on cancellation; paid orders are refunded through the payment provider; a cancelled job releases the rider.
Riders **accept** deliveries from a pool of READY_FOR_PICKUP orders (first valid claim wins, max 3 active), or the pharmacy can assign the nearest available rider.

## Architecture

```
src/app/(app)        Customer app: home, medicines (+[id]), find-medicine, upload-prescription, quick-order, checkout, orders (+[id], invoice), repeat, family, profile
src/app/(auth)       login, register, partner/pharmacy, partner/rider
src/app/pharmacy     Dashboard · Orders · Prescription Verification · Medicine Requests · Inventory · Customers · Payments · Reports · Settings
src/app/admin        Dashboard · Customers · Pharmacies · Pharmacy Verification · Orders · Medicine Requests · Riders · Service Areas · Payments · Settlements · Complaints · Reports · Settings · Audit log
src/app/delivery     Rider PWA: Deliveries (online switch, available, accept, pickup/delivery OTP, navigate, call) · History · Earnings
src/app/api/**       Thin route handlers: auth → zod validation → service
src/proxy.ts         Route-level RBAC
src/server/services  Business rules: finder, orders, delivery, pharmacy, requests, prescriptions, admin, accounts
src/server/          store (working set), persistence (MongoDB write-back), payments (provider interface), inventory (FEFO stock), notifications, seed, http
src/models/index.ts  Mongoose models + indexes
src/lib              order-machine, rbac, auth, validation, eta, pricing, signed-url, rate-limit, client store/hooks
tests/               lib, workflow (state machine, rules, rider privacy, admin), persistence (real MongoDB)
```

**Persistence.** With `DATA_SOURCE=mongo` the working set is loaded from MongoDB at server start (`src/instrumentation.ts`; an empty database is seeded) and every mutating request writes its changed documents back (per-document diff → `bulkWrite`). Business rules stay synchronous and tested; data and indexes are real MongoDB. It assumes one server instance. Horizontal scale needs async repositories behind the services (see TODOs).

## Models (`src/models/index.ts`)

User, FamilyMember, Address, Medicine, Pharmacy, PharmacyInventory, Prescription, MedicineRequest, MedicineRequestResponse, Cart, Order, OrderItem, DeliveryPartner, Delivery, Payment, Settlement, ServiceArea, Notification, SupportTicket,
plus SavedMedicine (refill-ready), Review, Offer, PlatformSettings, AuditLog, StoredFile.
Indexes: Medicine text(name, generic, brand, category) + each individually · Pharmacy servicePincodes/pincode/2dsphere · PharmacyInventory unique(pharmacy, medicine, batch) and (medicine, quantity, pharmacy) · Order code, (user, createdAt), (pharmacy, status, createdAt), status, createdAt · Prescription (user, createdAt), status.

## Customer routes

`/` home · `/medicines` search (Fastest / Cheapest / Nearest / My pharmacy) · `/medicines/[id]` compare pharmacies · `/find-medicine` · `/upload-prescription` · `/quick-order` (no account) · `/checkout` · `/orders` · `/orders/[id]` (+`/invoice`) · `/repeat` (previous orders + saved medicines) · `/family` · `/profile` · `/login` `/register`.

## API list

Auth `POST /api/auth/{login,register,logout}` `GET /api/auth/me` · `PATCH /api/me` `GET /api/me/export`
Catalog `GET /api/medicines/search` `GET /api/medicines/[id]/availability` `GET /api/medicines/meta` `GET /api/pharmacies/nearby` `GET /api/offers`
Location `GET /api/coverage` `POST /api/launch-signup`
Find medicine `GET|POST /api/medicine-requests`
Prescriptions `GET|POST /api/prescriptions` `GET /api/prescriptions/[id]` `GET /api/files/[key]` `POST /api/quick-order`
Cart `GET|PUT /api/cart`
Orders `GET|POST /api/orders` `POST /api/orders/quote` `GET|POST /api/orders/[id]` (cancel, pay, repeat, attach_prescription, save_medicines, review)
Saved medicines `GET|POST /api/saved` `POST|DELETE /api/saved/[id]` (reminder, reorder)
Profile `GET|POST /api/family` `PUT|DELETE /api/family/[id]` `GET|POST /api/addresses` `DELETE /api/addresses/[id]` `GET|POST /api/support` `GET /api/notifications`
Pharmacy `GET /api/pharmacy/{dashboard,orders,prescriptions,customers,payments,reports,requests,inventory,settings}` · `POST /api/pharmacy/orders/[id]` (review, step, reject, assign) · `POST /api/pharmacy/prescriptions/[id]` · `POST /api/pharmacy/requests/[id]` · `POST /api/pharmacy/inventory`, `PATCH /api/pharmacy/inventory/[id]`, `POST /api/pharmacy/inventory/bulk` · `PATCH /api/pharmacy/settings`
Rider `GET|PATCH /api/delivery/me` · `GET /api/delivery/{available,active,history,earnings}` · `POST /api/delivery/orders/[id]` (accept, pickup, start, deliver, drop)
Admin `GET /api/admin/{stats,reports,settings}` `PATCH /api/admin/settings` · `GET /api/admin/list/[entity]` (customers, orders, requests, payments, settlements, complaints, audit) · `GET /api/admin/partners/[kind]` `PATCH /api/admin/partners/[kind]/[id]` (pharmacies, riders) · `GET|POST /api/admin/service-areas` `PATCH …/[id]` · `POST /api/admin/settlements` `PATCH …/[id]` · `PATCH /api/admin/tickets/[id]`
Partners `POST /api/partners/{pharmacy,rider}`

## Safety rules enforced in code (tested)

Prescription medicines need a prescription; restricted medicines need an already-approved one; the pharmacist approves before preparation; items are never substituted; reorders and saved-medicine reorders go through the same review.
Riders never see medicine names, prescriptions or patient details; customer identity and exact address appear only after they accept; OTPs go only to the right party; OTP guessing is rate limited.
Prescription files are private: opaque keys, short-lived signed URLs bound to the session, `no-store`, access audit-logged; admin tables never show OTPs, file keys or medical content.
Uploads are checked by type, size and real file signature. Passwords are bcrypt-hashed. Zod validation on every input. Audit log for verification, prescription review, order decisions, settlements, settings.

## Implemented features

All 20 requested customer features (location/pincode detection, search, nearby availability, Fastest/Cheapest/Nearest, Find This Medicine For Me, prescription upload, pharmacist verification, cart, checkout, COD + payment-ready provider layer, landmark addresses, tracking, rider workflow, delivery OTP, previous orders, one-click reorder, family profiles, saved medicines, refill-reminder-ready data model + reminder job function, support entry point) plus the pharmacy, admin and rider apps listed above, partner self-registration, and settlements with commission.

## Remaining TODOs

- Async repository layer for multi-instance deployment (current MongoDB write-back assumes one instance).
- Real payment gateway (Razorpay) with webhooks and refunds; the MOCK provider stands in for UPI/card.
- Real SMS / WhatsApp / push / email providers behind `ChannelProvider`; a scheduler that calls `sendDueRefillReminders()`.
- Object storage (S3-compatible, encrypted, malware scan) for prescriptions instead of MongoDB.
- OTP-by-SMS login, CSRF token for cookie auth, account lockout, session management.
- Staff-created orders for "Call Me" customers; pharmacy geocoding on registration (new pharmacies have no map pin yet).
- Live rider location (customers currently see status steps, refreshed every 10 s); server-sent events instead of polling.
- Rider settlements are seeded only; pharmacy settlements can be generated.
- Full Hindi coverage (core strings only), accessibility audit with real users.
- Legal/regulatory review (Drugs & Cosmetics rules, DPDP Act, e-commerce rules) before any real patient uses it.
