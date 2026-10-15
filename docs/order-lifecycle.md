# Order, payment, delivery, cancellation and refund lifecycle

One rule runs through all of it: **the server decides, the browser asks.** Price, fees, stock, payment status, refund status and order status are never read from a request. Every change goes through one function that checks the current state, the actor and the business rules, then writes a history row and tells the customer.

Code lives in `src/server/features/{orders,payments,delivery,settlements}`. Time-based work (expiry, settlement eligibility, old idempotency keys) runs in `orders/housekeeping.ts`.

## 1. Order flow

```
checkout ──▶ PENDING ───────────────────────────────▶ CONFIRMED ─▶ PREPARING ─▶ READY_FOR_PICKUP ─▶ RIDER_ASSIGNED ─▶ PICKED_UP ─▶ OUT_FOR_DELIVERY ─▶ DELIVERED
        └──▶ PRESCRIPTION_REVIEW ─▶ PRESCRIPTION_APPROVED ─┘          (any step before pickup ─▶ CANCELLED, subject to the cancellation matrix)
```

**Checkout (`placeOrder`) does, in one all-or-nothing block:** valid address → live service area → pharmacy verified, open, delivers to the pincode → medicines exist and are active → stock (per pharmacy, expired batches excluded) → price integrity (a batch priced above its MRP is refused) → prescription rules → delivery fee, platform fee, discount, total, ETA → **reserve stock** → create order → create payment (and first attempt for online) → notify → clear cart. Any failure rolls all of it back.

* The body may only carry choices. A `total`, `status`, `paymentStatus`, `deliveryFee`, `discount`… in the body is refused (strict schema).
* `Idempotency-Key` header: the same key and basket returns the **first** order (`200`, "already placed"); the same key with a different basket is `422`. The key is stored 24 h and the order has a unique `(userId, idempotencyKey)` index.
* Stock lifecycle: reserve at checkout → consume when the pharmacy confirms → release (before confirm) or restock (after) on cancel. An unpaid online order, or one nobody confirmed in time, releases its stock when its window ends (`paymentWindowMinutes`, 30 by default; 2 h for the pharmacy to answer, 24 h for a prescription review).
* `transition()` is the only thing that changes `order.status`. It validates the state machine (`lib/order-machine.ts`), the actor role, ownership (via the callers), the cancellation matrix, runs side effects, appends an `OrderStatusHistory` row and sends the notification. There is no endpoint that sets a status directly: only action endpoints (`/confirm`, `/preparing`, `/ready`, `/cancel`, …).
* Prescription orders: any Rx item starts in `PRESCRIPTION_REVIEW`. An authorised pharmacist approves, rejects (needs a reason; cancels, releases stock, refunds) or asks for a clearer copy. Items are never edited or substituted.

### Partial fulfilment
The pharmacy lists unavailable items (with reasons). Nothing is removed. The customer sees the new total (computed on the server) and chooses **Continue with the rest** or **Cancel the whole order**. Meanwhile the pharmacy cannot move the order on and stock stays reserved. *Continue*: only the removed items' stock goes back, totals are recomputed, a prepaid order gets a **partial refund** of the difference. No answer within `partialProposalMinutes` (30) cancels and refunds the order (silence is never "yes"). Only allowed before the order is packed, and for online orders only after payment.

## 2. Payment architecture

```
Order ──1:1──▶ Payment ──1:N──▶ PaymentAttempt        Payment ──1:N──▶ Refund
                  │
                  └─ provider: "COD" | "MOCK" | "RAZORPAY" | …   (PaymentProvider interface, providers.ts)
```

* The **order never mentions a gateway.** What a gateway calls its ids (`providerOrderId`, `providerPaymentId`) lives on `Payment` and `PaymentAttempt`.
* `PaymentProvider`: `createPayment`, `verifyPayment` (webhook signature), `parseWebhook`, `getPaymentStatus`, `refundPayment`. Amounts cross the boundary in **paise**.
* **COD** is a first-class provider: no gateway call, status stays `PENDING` until the rider records the exact cash at the door (`recordCodCollection`), which is the only moment it becomes `PAID`.
* **Webhook = the only source of truth** for online payments. `POST /api/payments/webhook` is public but guarded by the gateway's signature over the **raw body**. Then: event id must be new (duplicates are acknowledged and ignored) → the attempt must exist and belong to the payment/order it names → the amount must equal what we asked for (mismatch: attempt fails, audit, support alerted, order **not** paid) → only then `PAID`. A failed handler rolls back and records nothing, so the gateway's retry is safe. The browser's "success" screen changes nothing.
* **Failed payment**: order stays, customer is told, stock is held for the same fixed window (a retry does **not** extend it). Options: *try again* (new attempt, same payment/order), *switch to cash on delivery* (if the total is within `codMaxAmount`), or cancel.
* **Late or odd money** is never kept: a capture that arrives after the order was cancelled, switched to COD, or already paid is refunded straight away (recorded as a `Refund`, audited).
* Dev only: `POST /api/payments/{id}/mock-complete` plays the gateway's checkout page by sending a **signed** webhook (same verified path). Disabled in production; production also refuses the mock provider.

## 3. Delivery state diagram

```
(order READY_FOR_PICKUP creates it)
WAITING_FOR_RIDER ─accept─▶ ASSIGNED ─arrived─▶ AT_PHARMACY ─pickup code─▶ PICKED_UP ─start─▶ OUT_FOR_DELIVERY ─delivery code (+cash for COD)─▶ DELIVERED
      ▲                         │                                                                      │
      └────── rider drops ──────┘                                                                      └─ rider reports failure ─▶ DELIVERY_FAILED
CANCELLED  (order cancelled before the parcel left the pharmacy)                                              │
                                                                       support: retry (max 3 attempts) ◀──────┤
                                                                       support: bring it back ─▶ RETURNING_TO_PHARMACY ─pharmacy confirms─▶ RETURNED_TO_PHARMACY
                                                                                                                                │ support cancels order ─▶ stock restocked, prepaid refunded
```

Order and delivery are separate records kept in step by domain services. A failed delivery **does not cancel the order**: the parcel is still in the rider's hands, so the order stays `OUT_FOR_DELIVERY` until support decides. Only after `RETURNED_TO_PHARMACY` can support cancel it. Reasons: `CUSTOMER_UNAVAILABLE`, `WRONG_ADDRESS`, `CUSTOMER_REFUSED`, `UNABLE_TO_CONTACT`, `UNSAFE_LOCATION`, `RIDER_ISSUE`, `OTHER` (needs a note). Customer, pharmacy and support are all alerted at each step.

* **Rider eligibility:** verified (`VERIFIED`), online, drop pincode inside the rider's service area (when set), and not busy (`maxConcurrentDeliveries`, default 1; a rider still holding a failed parcel counts as busy). Acceptance is one synchronous check-and-set, so only one rider can win; the same rider tapping twice gets the same job. (With MongoDB behind several servers this becomes one conditional update.)
* **Rider offer** shows pickup, drop **area** (not the street), distance, cash to collect and estimated earning. No medicine names, prescription, patient or health information.
* **Pickup code:** 4 digits, short-lived (1 h), only a keyed hash is stored, 5 wrong guesses lock it (counted even though the request fails), the pharmacy can issue a fresh one. **Delivery code:** same hashing and limits; the customer reads it out. COD must record the exact cash first; completing twice is harmless.
* **Location:** `POST …/location` only for the assigned rider on an active delivery. Only the **latest** point is stored (overwritten, cleared when the delivery ends, no history). Customers see it rounded (~100 m), only while picked up, hidden when stale.
* **ETA** (`lib/eta.ts`, settings `eta`): pharmacy prep + prescription check + finding a rider + travel, never below a minimum, always shown as a range ("30–40 min").
* **Delivery fee** (`orders/fees.ts`): the most specific service area with a `feeRule` wins (pincode → town → district → state); fee = `max(minFee, baseFee + (distance − includedDistanceKm) × perKmFee)`, capped at `maxFee`, plus `prioritySurcharge`; refused beyond `maxServiceRadiusKm`. No rule → platform flat fees. The fee and how it was worked out are frozen on the order.

## 4. Cancellation matrix

| Order status | Customer | Pharmacy staff | Support (admin) |
|---|---|---|---|
| PENDING, PRESCRIPTION_REVIEW, PRESCRIPTION_APPROVED, CONFIRMED | cancels now | cancels now | cancels now |
| PREPARING, READY_FOR_PICKUP, RIDER_ASSIGNED | **asks**; pharmacy approves or declines (with a reason) | cancels now | cancels now |
| PICKED_UP, OUT_FOR_DELIVERY | not possible | not possible | only after the parcel is back (`RETURNED_TO_PHARMACY`) |
| DELIVERED, CANCELLED | not possible | not possible | not possible |

The matrix is data in `orders/policy.ts` (`CANCELLATION_MATRIX`) and enforced inside `transition()`, so no path can skip it. Each cancellation stores `cancelReasonCode` (structured), `cancelReason` (text), `cancelledBy`, `cancelledByUserId`, `cancelledAt`, releases or restocks inventory, closes or refunds the payment, notifies the customer and writes an audit row with before/after.

## 5. Refund rules

* Statuses: `PENDING → PROCESSING → COMPLETED | FAILED`. An order's `refundStatus` is `NOT_REQUIRED`, `PENDING`, `PROCESSING`, `COMPLETED`, `FAILED` or `PARTIAL` (some, not all, of the payment returned). The customer sees it on the order and in the payment.
* **When:** cancelling a paid online order refunds it in full (delivery fee included); partial fulfilment refunds the difference; support can refund any amount up to what is left. Unpaid orders just close their payment; COD with no cash taken has nothing to refund.
* **Idempotent:** a refund has a key (`cancel:<orderId>`, `partial:<orderId>:<n>`, or the admin's `Idempotency-Key`). The same key returns the same refund; a different amount under the same key is `422`; open + finished refunds can never exceed what was paid. A `FAILED` refund is retried by repeating its key (the admin "Delivery problems" screen does this).
* A gateway that answers "processing" keeps the refund `PROCESSING` until its `REFUND_PROCESSED` webhook arrives (also idempotent). A failed refund alerts support and tells the customer it is being fixed.

## 6. Settlement logic

**Pharmacy**, per delivered order not yet settled: `medicine revenue − discount allocation − platform commission − refund adjustment ± manual adjustments = net payable`.
* Discount allocation = the pharmacy's share of an offer (`100 − discountPlatformSharePercent` %).
* Commission = `commissionPercent` of (revenue − discount allocation).
* Refund adjustment = completed refunds after delivery (refunds for dropped items are excluded: they are not in the revenue).
* Delivery fee and platform fee are never the pharmacy's.

**Rider**, per delivered delivery: `base + distance earning + incentive ± adjustments`. Distance earning = `(km − 1) × riderPerKm`.

**Status:** `PENDING` (hold period, `settlementHoldHours`, 24 h) → `ELIGIBLE` → `PROCESSING` → `PAID`; `PROCESSING → FAILED → PROCESSING`; any open state → `ON_HOLD` (reason required) → back. `PAID` is final. Adjustments need a reason, are blocked once paid, and are audited with before/after.

## 7. APIs

| Who | Endpoint |
|---|---|
| Customer | `POST /api/orders` (Idempotency-Key) · `GET /api/orders` · `GET /api/orders/{id}` · `POST /api/orders/{id}/cancel` · `POST /api/orders/{id}/payment/retry` · `POST /api/orders/{id}/partial-fulfillment` |
| Pharmacy | `POST /api/pharmacy/orders/{id}/confirm` · `/preparing` · `/ready` · `/partial-fulfillment` · `/cancellation` · `/return-received` · `/pickup-code` (also `/approve`, `/reject`) |
| Payment | `POST /api/payments/create` · `POST /api/payments/webhook` (signature) · `GET /api/payments/{id}` · `POST /api/payments/{id}/refund` · `POST /api/payments/{id}/mock-complete` (dev) |
| Rider | `GET /api/rider/deliveries/available` · `POST /api/rider/deliveries/{id}/accept` · `/arrived` · `/pickup` · `/out-for-delivery` · `/location` · `/complete` · `/failed` |
| Admin / support | `POST /api/admin/orders/{id}/cancel` · `/api/admin/deliveries/{id}/retry` · `/return` · `/api/admin/payments/{id}/refund` · `PATCH /api/admin/settlements/{id}` · `POST …/settlements/{id}/adjust` · `POST /api/admin/settlements` |

Every route needs a session and the right role, except the webhook, which needs a valid gateway signature (and is on the reviewed public list in `tests/route-guards.test.ts`). Admin money actions need a recent password confirmation.

## 8. Configuration (platform settings, no deploy needed)

`platformFee`, `codMaxAmount`, `riderPerKm`, `maxConcurrentDeliveries`, `settlementHoldHours`, `discountPlatformSharePercent`, `partialProposalMinutes`, `paymentWindowMinutes`, `eta.*`, `commissionPercent`, delivery fees; per service area: `feeRule`.

## 9. Audit and notifications

Audit rows store `actorId`, `actorRole` (including `SYSTEM`), `action`, `targetType`/`targetId`, `before`, `after`, `meta`, time — for cancellation and requests, prescription decisions, payment switched to COD, amount mismatches, refunds (requested/failed), delivery failure/retry/return/received, partial fulfilment, settlement status and adjustments. Notifications go through the existing vendor-neutral `notify()`; bodies never contain medicine names.

## 10. Tests

`tests/lifecycle.test.ts` (74 tests) plus the updated suites: duplicate and concurrent checkout, inventory release and expiry, payment success/failure, duplicate webhook, bad signature, amount tampering, payment retry, switch to COD, late capture refunds, COD, invalid transitions, pharmacy ownership, customer cancellation (free / request / after pickup), refund idempotency / partial / failed / processing, partial fulfilment, simultaneous rider acceptance, pickup and delivery codes (hash only, expiry, attempts), failed delivery, retry and return flow, location privacy, fee rules, ETA, settlement maths and status flow, audit before/after. `tests/persistence.test.ts` round-trips every collection through a real MongoDB when one is running.

## 11. What is still needed for production

1. **A real gateway adapter** (e.g. Razorpay, Cashfree, PayU): implement `PaymentProvider`, register it, set `PAYMENT_PROVIDER` and the gateway's webhook secret; map its event names to `PAYMENT_CAPTURED / PAYMENT_FAILED / REFUND_PROCESSED / REFUND_FAILED`; configure the webhook URL. Add a reconciliation job that calls `getPaymentStatus` for attempts stuck `PENDING`.
2. **Real MongoDB transactions** across several servers: `atomically()` is all-or-nothing inside one Node process; with more than one instance, switch it to a session transaction (`MONGO_TRANSACTIONS=true`) and make rider acceptance one conditional update.
3. **Payout rails** for settlements (bank/UPI payout API, bank-statement reconciliation) — status changes are manual today.
4. **SMS / WhatsApp / push providers** behind `ChannelProvider`; cash-deposit reconciliation for riders (COD cash vs. what is handed in).
5. **Existing databases** created before this change need `npm run db:reset` (the app detects an old database and falls back to the in-memory demo store rather than writing to it). Replace any index named `userId_1_idempotencyKey_1` created from an earlier draft.
6. Refund-failure and stuck-payment **alerts** to a pager/dashboard, and legal review of the cancellation and refund wording.
