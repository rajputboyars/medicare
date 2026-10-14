# DawaDost design system

Simple first: few steps, plain words, large tap targets, usable by someone who has never used a health app.
Tokens live in `src/app/globals.css` (`@theme`); components live in `src/components/ui`.

## Tokens
| Area | Tokens |
|---|---|
| Colour | `brand` (teal), `ink`, `muted`, `subtle`, `canvas`, `surface`, `surface-2`, `line`, `line-strong`, `ok`, `warn`, `emergency`, `info` (each status colour has `-50` and `-line`) |
| Radius | `rounded-control` 14px, `rounded-card` 16px, `rounded-sheet`, `rounded-pill` |
| Shadow | `shadow-soft`, `shadow-raised`, `shadow-overlay` |
| Type | `t-display`, `t-page`, `t-section`, `t-card`, `t-body`, `t-support`, `t-label`, `t-caption`, `t-number` |
| Tap target | `tap` = 48px minimum height and width |
| Breakpoints | `xs` 360, `phone` 390, `phablet` 430, `sm` 640, `md` 768, `lg` 1024 (sidebar appears), `xl` 1280, `2xl` 1440 |

Large-text and high-contrast modes (Profile → Display) are driven by `data-` attributes on `<html>`.

## Rules
- A status is never colour alone: `StatusBadge` always has an icon and words.
- Destructive actions (reject, cancel, delete) always use `ConfirmationDialog`, with a reason where the other side will read it.
- Fees are never hidden. The bill always shows Items, Pharmacy, Medicine subtotal, Delivery, Other fees, Total.
- Every list handles loading (`Skeleton*`), empty (`EmptyState`), error (`ErrorState`, offline-aware) and success (`Success`).
- Phones get a bottom bar (customer, rider); desktops get a sidebar (pharmacy, admin; customer from 1024px).
- Below-the-fold sections use `LazyMount`; dialogs load with `next/dynamic`.

## Components
**Primitives** — `Button`, `LinkButton`, `IconButton`, `Input`, `Select`, `Textarea`, `Toggle`, `Card`, `Badge`, `StatusBadge`, `Modal`, `ConfirmationDialog`, `SearchBar`, `Skeleton`, `SkeletonCard`, `SkeletonMetric`, `SkeletonList`, `LazyMount`

**Feedback** — `EmptyState`, `ErrorState`, `Notice`, `Success`, `OperationalAlert`, `QueryBoundary`

**Layout** — `AppShell`, `PortalShell`, `Sidebar`, `MobileNavStrip`, `BottomNavigation`, `AppHeader`, `LocationSelector`, `PageTitle`, `SectionHeader`

**Dashboards** — `DashboardMetricCard`, `EntityTable` (cards on phones, table from 768px)

**Orders** — `OrderStatusBadge`, `OrderStatusTimeline`, `describeStatus` / `describeDone` (`src/lib/order-copy.ts`), pharmacy `OrderCard`

**Customer** — `QuickActionCard`, `FamilyMemberCard`, `FamilyPicker`, `PrescriptionBadge`, `RequestTracker`, `SortChips`, `PharmacyAvailabilityCard`, `MedicineCard`, `PrescriptionPicker`

**Rider** — `DeliveryStepper`, `RiderShell`

## Where each app lives
| App | Shell | Navigation |
|---|---|---|
| Customer | `AppShell` | Home, Medicines, Orders, Profile |
| Pharmacy | `PortalShell` | Dashboard, Orders, Medicine Requests, Prescriptions, Inventory, Customers, Payments, Reports, Settings |
| Rider | `RiderShell` | Deliveries, History, Earnings |
| Admin | `PortalShell` | Dashboard, Users, Pharmacies, Orders, Medicine Requests, Delivery Partners, Service Areas, Payments, Settlements, Complaints, Reports, Settings |
