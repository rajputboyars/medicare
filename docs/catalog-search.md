# Medicine catalogue, inventory and search

## Architecture in one picture

```
Medicine (master, one per product, admin-controlled)      PharmacyInventory (one row per pharmacy + medicine + batch)
  name · genericName · brand · manufacturer · strength      price · MRP · batch · expiry · stock · reserved · status
  dosageForm · packSize · prescriptionRequired              lastUpdatedAt · updatedBy
  searchAliases · searchKeywords · normalized* · status
            │                                                         │
            └──────────── availabilityFor(medicineId, pincode) ───────┘
                          verified pharmacy · open for orders · delivers there · valid stock · honest ETA
```

* **Medicine is the only catalogue.** Pharmacies never get a copy; they attach price, stock, batch and expiry to a catalogue medicine. Unknown medicines go to an admin (match / create / reject), never straight into the catalogue.
* **Search is a thin layer over normalised fields** (`src/lib/search-normalize.ts`, `src/server/features/catalog/search-core.ts`). V1 scans the active catalogue in memory and ranks it; the same normalised fields are what you would index in Atlas Search / Elasticsearch / Typesense later, and the ranking tests describe the behaviour to keep.

```
src/lib/search-normalize.ts        normalise, compact, tokenise, typo tolerance (edit distance with early exit)
src/lib/medicine-fields.ts         derive normalised fields on every create/update (cannot go stale)
src/server/features/catalog/
  search-core.ts                   scoring + ranking
  catalog.service.ts              searchCatalog · suggestMedicines · availabilityFor · recent searches · preferred pharmacies
  confidence.ts                   stock freshness (configurable)
  medicine-admin.service.ts       create / update / retire with duplicate detection
  insights.service.ts             aggregate admin insights
src/server/features/inventory/
  stock.ts                        reserve / consume / release / restock (FEFO)
  import.service.ts               CSV preview → confirm, match review
```

## Medicine schema

`name`, `normalizedName`, `genericName`, `normalizedGenericName`, `brand`, `manufacturer`, `strength`, `dosageForm`, `packSize`, `category`, `mrp` (reference), `prescriptionRequired`, `restricted`, `searchAliases[]`, `searchKeywords[]`, `image`, `description`, `status` (`ACTIVE` / `INACTIVE`), `createdAt`, `updatedAt`.
Normalisation: lower-case, punctuation and hyphens become spaces, letters and digits are separated, spaces collapse. `Telma-40`, `TELMA 40` and `telma40` all reduce to `telma 40`. Normalised fields are rebuilt on every create and update.

## Inventory schema

| Field | Notes |
|---|---|
| `pharmacyId`, `medicineId` | the pair identifies the product at that pharmacy |
| `batch`, `expiry` | spec names `batchNumber`, `expiryDate` (kept short in code) |
| `mrp`, `sellingPrice` | selling price can never exceed MRP; both > 0 |
| `stockQuantity`, `reservedQuantity` | `availableQuantity = stockQuantity − reservedQuantity`; negative stock and `reserved > stock` are refused |
| `lowStockThreshold` | per row, default 10 |
| `status` | `ACTIVE` / `INACTIVE` (inactive rows are never offered) |
| `lastUpdatedAt`, `updatedBy`, `createdAt`, `updatedAt` | spec name `lastStockUpdateAt`; refreshed by every stock change |

Expired stock is **kept** (history, returns) but is never available. Nothing is deleted automatically.

## Indexes

Medicine: text (`normalizedName`×10, `searchAliases`×8, `brand`×6, `normalizedGenericName`×5, `searchKeywords`×2) · `normalizedName` · `normalizedGenericName` · `searchKeywords` (multikey) · (`status`, `category`) · (`status`, `prescriptionRequired`) · (`normalizedName`, `strength`, `dosageForm`, `manufacturer`) for duplicate checks.
PharmacyInventory: unique (`pharmacyId`, `medicineId`, `batch`) · (`medicineId`, `stockQuantity`, `pharmacyId`) · (`pharmacyId`, `stockQuantity`) · (`pharmacyId`, `status`, `expiry`) · (`medicineId`, `status`, `expiry`, `stockQuantity`).
Others: Order `reservationExpiresAt` (sparse) · SearchHistory (`userId`, `at`) · InventoryImport (`pharmacyId`, `createdAt`) · MedicineMatchReview (`status`, `createdAt`).

## Search

`GET /api/medicines/search?q&pincode&page&limit&prescriptionRequired&availability&sort`
Searches name, generic name, brand, aliases, keywords (and dosage form / manufacturer words). A result needs every meaningful word to match; scoring: whole-query equals a name/alias/"name + strength" (100) > name starts with it (85) > compact containment (70) > word matches (exact 10, prefix 7, small typo 4), each multiplied by how trustworthy the field is (name 1, alias .95, brand .85, generic .8, keyword .4). Typos are forgiven for words of 4+ letters (1 typo up to 7 letters, 2 beyond); numbers and short words must match exactly, so `telma 41` does not find the 40 mg.
Each item: `medicine`, `startingPrice` (null when nobody has it), `availablePharmacyCount`, `fastestETA` (null when no honest estimate), `prescriptionRequired`, `match`. Paginated (`meta`), `sort` = RELEVANCE | PRICE | ETA | NAME.
`GET /api/medicines/suggestions?q&limit` returns up to 10 `{medicineId, name, strength, generic, brand}`; the screen debounces at 250 ms.

## Availability algorithm

`GET /api/medicines/[id]/availability?pincode&sort=FASTEST|CHEAPEST|NEAREST`

1. Medicine must be `ACTIVE`. Check the service area for the pincode (`covered`, with a friendly message when not).
2. Pharmacies: `VERIFIED`, `acceptingOrders`, deliver to the pincode, within their delivery radius.
3. Stock per pharmacy: batches that are `ACTIVE`, not expired, with `available > 0`. Quantity = sum of available; price and MRP come from the batch that ships first (earliest expiry).
4. Delivery: `estimateEta` from distance, the pharmacy's prep time, whether any rider is online and whether a prescription check is needed. **No estimate** (`minutes: null`) when the pharmacy is closed (`basis: CLOSED`, with its opening time) or distance is unknown; ranges are always ranges; no rider online adds a note.
5. `deliveryFee` from platform settings; `estimatedTotal = price + delivery fee` (one pack).
6. `inventoryConfidence`: HIGH within 12 h of the last update, MEDIUM within 72 h, else LOW (`STOCK_CONFIDENCE_HIGH_HOURS`, `STOCK_CONFIDENCE_MEDIUM_HOURS`). LOW sets `confirmationMayBeNeeded`.
7. Sorting (unknown values always last): **FASTEST** open first, then shortest ETA, then distance · **CHEAPEST** `estimatedTotal`, then distance · **NEAREST** distance, then total. A preferred (favourite) pharmacy is badged and only breaks exact ties.

## CSV import and match review

Columns: `medicine_name, batch, expiry, mrp, selling_price, stock` plus optional `generic_name, strength, manufacturer` (friendly header variants are accepted). Max 2000 rows, 1 MB, `.csv` only.

1. **Preview** (`POST /api/pharmacy/inventory/import`): parse, validate, normalise, match. Nothing is written. Each row is `MATCHED` (one clear catalogue medicine), `POSSIBLE_MATCH` (typo, different strength or several candidates; never attached silently), `NOT_FOUND` or `INVALID` (bad date/price/stock, selling > MRP, duplicate batch in the file).
2. **Confirm** (`POST …/import/[id]/confirm {choices}`): imports matched rows and the possible matches the pharmacy chose; the rest of the possible matches and all `NOT_FOUND` rows become **MedicineMatchReview** items for an admin; invalid rows are skipped. A row that would drop stock below promised units is skipped with a reason. An import can be confirmed once.
3. **Admin review** (`/admin/medicine-matches`): **MATCH** an existing medicine, **CREATE** a new one (exact duplicates refused; near duplicates need an explicit confirmation), or **REJECT** with a reason. Matching/creating adds the inventory line for that pharmacy and notifies it. Duplicate check compares name (and aliases), generic, strength, form, manufacturer and pack size, ignoring case, spacing and punctuation; blanks never hide a duplicate and a different maker is a different product.

## Reservation logic

Checkout is one synchronous step: validate → compute prices from inventory → reserve FEFO (`reservedQuantity += n`) → create the order. Any failure rolls the whole checkout back (`atomically`), so units cannot leak. Because the check and the reservation cannot interleave inside one process, parallel customers can never oversell (tests run 20 simultaneous attempts and parallel API calls against 3–5 units).

| Event | Effect | `stockState` |
|---|---|---|
| checkout | reserved += n | RESERVED |
| pharmacy confirms | stock −= n, reserved −= n | CONSUMED |
| cancel / reject / **expiry** before confirm | reserved −= n | RELEASED |
| cancel after confirm | stock += n | RELEASED |

**Expiry is decided by the server**, stored on the order as `reservationExpiresAt`: online unpaid 30 min; paid (pharmacy's turn) or COD 2 h; prescription orders 24 h. `expireReservations()` runs from the 60-second housekeeping timer (`src/instrumentation.ts`) and also before checkout and list requests, so no page or browser timer is involved. It cancels as SYSTEM through the state machine, releases the batches recorded on the order, tells the customer, and is idempotent. Multi-instance deployments should use a conditional `$inc` (`stock − reserved >= n`) inside a MongoDB transaction behind the same function boundaries (documented in `tx.ts`).

Prices are never accepted from the client (order bodies are strict); a batch priced above its own MRP is refused; the order stores a price snapshot.

## API list

Public: `GET /api/medicines/search` · `GET /api/medicines/suggestions` · `GET /api/medicines/[id]` · `GET /api/medicines/[id]/availability`
Customer: `GET|DELETE /api/me/search-history` · `GET|PUT /api/me/favorite-pharmacies` · `POST /api/analytics/event` (`medicine_selected`, `pharmacy_selected`, `medicine_added_to_cart`, `find_medicine_clicked`)
Pharmacy: `GET|POST /api/pharmacy/inventory` · `PUT|PATCH /api/pharmacy/inventory/[id]` · `PATCH /api/pharmacy/inventory/[id]/stock` (`{stockQuantity}` or `{delta}`) · `GET|POST /api/pharmacy/inventory/import` (template / preview) · `GET|DELETE /api/pharmacy/inventory/import/[id]` · `POST …/confirm`
Admin (sensitive ones need a recent password confirmation): `GET|POST /api/admin/medicines` · `PATCH /api/admin/medicines/[id]` · `GET /api/admin/medicine-matches` · `POST /api/admin/medicine-matches/[id]` · `GET /api/admin/catalog-insights`

Server-recorded analytics: `medicine_search`, `search_no_result` (normalised query ≤ 40 chars, result count, pincode, **no user id**), `availability_viewed`. Insights are aggregates only: top searches, no-result searches, areas with thin availability, low-stock frequency, medicine-request answer/conversion rate. They describe catalogue and stock coverage, not medical advice.

## Security

Only the pharmacy's own staff (verified pharmacy) change its inventory; other pharmacies, customers, riders and unapproved applicants get 403; admins review and resolve matches but do not edit a pharmacy's stock. Every identifier is checked server-side. Stock changes, edits, imports and match decisions are audit-logged (with before/after). Recent searches are private per customer and can be cleared; guests' stay in their own browser.

## Remaining production integrations

A dedicated search engine (Atlas Search / Typesense) behind `searchCatalog` for very large catalogues and language-aware matching · a licensed drug database to seed and update the catalogue · real distance/ETA from a routing API · barcode scanning for stock entry · POS/billing integrations calling the import endpoints · image hosting for medicine photos · conditional-update reservations inside MongoDB transactions for multi-instance deployments · Redis-backed shared rate limits and search cache.
