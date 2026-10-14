# DawaDost Rider: Onboarding and Feature Guide

This guide describes the delivery-partner experience currently implemented in DawaDost, from application through delivery completion and earnings review. It is based on the application code; it is not a promise of processes that are not yet built.

## 1. Apply to become a delivery partner

Open [`/partner/rider`](http://localhost:3000/partner/rider) or use **become a delivery partner** from the login page. The application form asks for:

| Field | Requirement |
| --- | --- |
| Name | 2–80 characters |
| Mobile | Valid mobile number |
| Email | Valid email address |
| Password | 8–128 characters, including a letter and a number |
| Vehicle | Vehicle type and registration/details, 3–60 characters; an example is shown |

Selecting **Apply** submits the application. Duplicate mobile numbers or email addresses are rejected. Registration is rate limited to three attempts per hour.

On success, a rider profile and login account are created with verification status **PENDING** and availability **offline**. The confirmation says the team will verify the details and that the rider can go online and accept deliveries after approval.

### What the application form does not collect

The current rider application does not ask for identity documents, a driving licence upload, a profile photo, bank/payment details, or a preferred service area. Vehicle details are free text.

## 2. Verification and account access

An administrator reviews rider applications in **Admin → Verification queue → Riders**. The implemented review actions include verifying an applicant and rejecting a pending application with a reason. Verification decisions are audit logged. The verification service also supports **SUSPENDED** and **PENDING** statuses, although those are not presented as actions in the rider verification page.

The rider can log in at [`/login`](http://localhost:3000/login) with the email or mobile number and password supplied during registration. Login routes delivery-partner accounts to `/delivery`.

Until the rider is **VERIFIED**, the rider shell displays a verification notice; the rider cannot go online and is not offered available deliveries. A verified rider can use the availability switch in the header.

### Development demo account

In non-production builds, the login page has a **Demo accounts (development only)** section. Choose **Rider** to fill the seeded rider account, then submit the form with the displayed development demo password. This account is already verified for trying the delivery dashboard; it is different from a newly submitted application, which starts pending.

## 3. Rider app and availability

The rider experience has three main tabs:

- **Deliveries** (`/delivery`): availability, today’s quick stats, active jobs, and available jobs.
- **History** (`/delivery/history`): completed deliveries and their payouts.
- **Earnings** (`/delivery/earnings`): today, last-seven-days, and all-time totals.

Rider profile information, verification, current availability, active-job count, and today’s delivery stats are loaded in the rider shell. The app refreshes rider summary about every 30 seconds and active/available delivery lists about every 10 seconds.

Verified riders can toggle between **Online** and **Offline**. Going online makes eligible offers visible. The app prevents going offline while the rider has active delivery work; the rider must finish or otherwise resolve active work first.

The rider area has its own **DawaDost Rider** installable web-app manifest and install prompt. Supported browsers can offer installation; on iOS, the UI explains how to use **Add to Home Screen**. Installation does not make order actions work offline: delivery information and actions are fetched from the app and require connectivity.

## 4. Review and accept an offer

Available deliveries are shown only to verified, online riders. Each offer can show:

- Order code, ready time, parcel count, and rider payout.
- Pharmacy name/address and distance to the pharmacy when location data is available.
- Drop area/pincode and estimated distance when the customer location is available.
- Priority-delivery indicator.
- Cash-on-delivery amount to collect, when applicable.

Offers are ordered by distance to the pharmacy when known, then by ready time. Before acceptance, the rider sees only a broad customer drop area—not the customer's identity, exact address, or contact number. Selecting **Accept delivery** assigns the job if it is still unassigned and ready; if another rider has claimed it, the app reports that it is no longer available.

## 5. Pick up and deliver

After accepting, the delivery appears under **My active deliveries**. The active job contains the information and actions needed for handoff:

1. **Go to the pharmacy.** The rider can call the pharmacy or open directions in Google Maps.
2. **Confirm pickup.** Enter the 4-digit pickup code provided by the pharmacy and select **Confirm pickup**. The code must be correct. Before pickup, the rider can select **I can’t do this delivery** to release the job back to the ready-for-pickup pool.
3. **Start delivery.** After pickup, select **Start delivery**. The order changes to out for delivery and the customer is notified that it is on the way and should have the delivery code ready.
4. **Go to the customer.** The rider can see the customer's contact name, phone number, delivery address, and landmark, and can call or open directions when map coordinates are available.
5. **Collect cash if shown.** For cash-on-delivery orders, the app displays the exact amount to collect. Cash collection is reflected in the delivery and earnings records when delivery is completed.
6. **Complete delivery.** Ask the customer for the 4-digit delivery code, enter it, and select **Complete delivery**. A correct code marks the order delivered, records the completion and payout, and notifies the customer. For COD, payment is marked paid as part of completion.

The rider workflow does not reveal medicine names, prescriptions, or other medical details. The interface instructs riders to keep parcels sealed and handle them carefully.

Pickup and delivery codes must be four digits. Order-action requests are rate limited to eight per rider/order per ten-minute window, which also limits code-guessing attempts. Delivery actions are restricted to the signed-in rider assigned to that order and to valid order-state transitions.

## 6. History and earnings

### Delivery history

The history tab lists the rider’s most recent completed deliveries (up to 100), with order code, delivery area/pincode, completion date/time, payout, and cash collected where applicable. An empty state appears when there are no completed deliveries.

### Earnings

The earnings tab summarizes:

- Earnings and delivery count for today.
- Earnings for the last seven days.
- All-time earnings.
- A chart of daily earnings for the last seven days.
- Cash collected today, when applicable, with a reminder to deposit it as instructed by the platform.

Payouts are settled by the platform team. The app presents earnings summaries; it does not provide an in-app rider withdrawal or payout request flow.

## 7. Privacy and operational boundaries

- Exact customer contact and address details are revealed only after a rider accepts the job.
- Medical order contents and prescriptions are not included in the rider delivery view.
- A rider can only update deliveries assigned to that rider.
- A rider can release an assigned job only before pickup; after pickup, the rider cannot release it through the rider workflow.
- The app displays COD amounts and records cash collection after successful completion; it does not itself transfer or reconcile physical cash.
- The implemented application flow does not include document upload, automated identity/licence checks, rider-side application status tracking, or a complete onboarding checklist.

## Related implementation

- Rider application form: [`src/app/(auth)/partner/rider/page.tsx`](../src/app/(auth)/partner/rider/page.tsx)
- Rider registration validation and API: [`src/lib/validation.ts`](../src/lib/validation.ts), [`src/app/api/partners/rider/route.ts`](../src/app/api/partners/rider/route.ts)
- Rider account creation and administrator verification: [`src/server/services/admin.ts`](../src/server/services/admin.ts), [`src/app/admin/verification/page.tsx`](../src/app/admin/verification/page.tsx)
- Login and rider shell: [`src/app/(auth)/login/page.tsx`](../src/app/(auth)/login/page.tsx), [`src/components/delivery/rider-shell.tsx`](../src/components/delivery/rider-shell.tsx)
- Delivery operations: [`src/app/delivery/page.tsx`](../src/app/delivery/page.tsx), [`src/server/services/delivery.ts`](../src/server/services/delivery.ts)
- History and earnings: [`src/app/delivery/history/page.tsx`](../src/app/delivery/history/page.tsx), [`src/app/delivery/earnings/page.tsx`](../src/app/delivery/earnings/page.tsx)
