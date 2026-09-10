# Madina Express software audit

Audit updated: 11 September 2026

## Executive result

The application has a working Node.js/Express and MySQL backend, and the main transport workflows persist centrally rather than in browser storage. Bookings, reservations, refunds, routes, trips, buses, crew, staff accounts, expenses, ledger entries, and audit events are served through authenticated APIs. The counter POS opens ready to sell without a shift step. Financial totals remain off the staff dashboard, while finance and expenses are admin-only with a timed password re-check. The interface now has scrollable navigation, balanced typography, a direct schedule date picker, stable schedule columns, and dependency-safe deletion for routes, buses, trips, and crew.

The release is deployed for controlled operational acceptance testing on the production VM. The client website and its API are disabled in both frontend and backend configuration. They must remain disabled until official Madina Express 1Bill merchant credentials and the private provider integration specification are supplied and verified.

## Workflow coverage

| Area | Implemented | Remaining enhancement |
| --- | --- | --- |
| Public booking | Implemented but hidden by frontend and backend feature flags | Configure and verify signed 1Bill invoice, callback, status, void and refund calls before enabling |
| Counter sales | Paid tickets, discounts, payment reference, passenger ID, server ticket numbers | Configurable discount approval limits |
| Reservations | Two-hour hold, server expiry, cash confirmation, unpaid cancellation, seat release | Background scheduler for expiry even when there is no API traffic |
| Bookings/refunds | Search/edit/print/export, partial/full refunds, refund register, refund limits, full-refund seat release | Manager approval threshold and provider-side non-cash reversal |
| Trips/dispatch | Recurring service days, date picker, bus/crew/platform assignment, boarding/departure/next-run states and safe deletion | Delay/cancellation/rebooking and assignment-conflict warnings |
| Fleet | Vehicle, capacity, model, status, service note and dependency-safe deletion | Maintenance work orders, odometer, fuel, tyres, permits and expiry alerts |
| Routes/fares | Routes, fare, distance, duration, boarding point, active/paused state and dependency-safe deletion | Intermediate stops, stop-level inventory and fare history |
| Finance | Admin-only, blurred until administrator password re-check, append-only sale/refund/expense ledger, channel totals and CSV | Approval workflow, accounting export and locked closed-period reporting |
| Expenses | Standalone audited expense entry and history without shift opening or closing | Supervisor approval for large expenses |
| Crew/access | Crew directory, safe deletion and role-scoped staff sign-in accounts | Account disable/reset UI, roster, leave, attendance and document expiry |
| Security/audit | Trusted HTTPS, password hashing, lockout, secure session controls, CSRF, RBAC, security headers and audit log | Centralized logs/alerts and independent penetration test |
| Recovery | Least-privilege app database user, scheduled local SQL backups and tested backup jobs | Encrypted off-machine backups and documented restore drill |

## Controls verified

- Anonymous requests cannot access staff data.
- Public website and public booking APIs are disabled until 1Bill is ready.
- Server pricing prevents client-side fare or total manipulation.
- The database unique constraint rejects simultaneous use of the same seat and trip run.
- A refund cannot exceed the remaining paid balance.
- Non-cash refunds require a traceable reference.
- Partial refunds retain occupied seats; a complete cumulative refund releases them.
- Paid bookings cannot be cancelled without using the refund workflow.
- CSRF tokens protect state changes and role permissions block counter staff from refunds.
- New staff accounts require strong temporary passwords and a first-login password change.
- Only the main administrator can unlock finance and expenses; staff roles are rejected by the server.
- Staff can create sales and collect reservation payments immediately after sign-in; shift endpoints are removed.
- Routes, buses, trips, and crew can be deleted when safe, while dependency checks protect trip and ticket history.
- Sales, refunds, expenses, authentication, and sensitive changes create audit or ledger records.

## Test evidence

- TypeScript production build: passed
- ESLint: passed with zero warnings
- Node.js backend syntax checks: passed
- Automated Node.js/MySQL integration suite: 40 checks passed
- npm production dependency audit: 0 known vulnerabilities
- MySQL backup generation: passed
- Apache staff login, management fallback, assets, and authenticated API endpoints: HTTP 200 as expected; disabled public booking API: intentional HTTP 404
- Headless Chrome interaction suite: 26 checks passed across the Node runtime, hidden client site, guarded management routes, login, immediate POS access, sidebar scrolling, typography, schedule date picking/table actions, master-record delete controls, expense navigation, protected finance, staff access, and logout

## Before an internet-facing launch

1. Obtain and validate official 1Bill merchant credentials and private integration documentation; implement signed callbacks, idempotency, reconciliation, void/status calls, and provider refunds.
2. Configure a real domain with TLS, set `SESSION_SECURE=true`, restrict `ALLOWED_ORIGINS`, and set production URLs.
3. Schedule encrypted off-machine backups and execute a restore drill on a separate database.
4. Configure centralized error/security monitoring and alerting for API failures, failed logins, database capacity, payment callbacks, and backup failures.
5. Run user acceptance testing with counter, dispatcher, finance, and manager staff; verify printers, terminal network reliability, direct-sale procedures, and refund authority.
6. Add the operational enhancements most important to the business: trip cancellation/rebooking, maintenance records, crew roster/document expiry, and account disable/reset.
