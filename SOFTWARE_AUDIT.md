# Madina Express software audit

Audit updated: 25 September 2026 · Version 2

## Executive result

The application now follows one practical operating loop: maintain a weekly roster, sell or reserve seats against a dated departure, collect reservation payment at the counter, dispatch the dated run, and print the ticket or passenger documents. Public reservations and counter activity use the same MySQL seat inventory. The staff workspace is shared by all permitted roles; there are no separate admin and sales products and no opening or closing shift step. Finance and expenses remain admin-only behind a timed password re-check.

The public website is enabled for live timetable search and unpaid two-hour reservations. Online payment remains disabled and is labelled as coming soon. Cash and card collection work at the counter; 1Bill is blocked in both the interface and backend until official credentials and the private provider specification are supplied.

## Workflow coverage

| Area | Implemented | Remaining enhancement |
| --- | --- | --- |
| Public booking | Live timetable, seat availability and two-hour reservations in the shared inventory | Add signed 1Bill invoice/callback/status/void/refund calls before enabling online purchase |
| Counter sales | Paid tickets, discounts, payment reference, passenger ID, server ticket numbers | Configurable discount approval limits |
| Reservations | Two-hour hold, server expiry, cash confirmation, unpaid cancellation, seat release | Background scheduler for expiry even when there is no API traffic |
| Bookings/refunds | Search/edit/print/export, partial/full refunds, refund register, refund limits, full-refund seat release | Manager approval threshold and provider-side non-cash reversal |
| Trips/dispatch | Weekly roster plus separate dated run status, date picker, bus/crew/platform assignment, boarding/departure state, basic assignment-conflict checks and safe deletion | Trip cancellation/rebooking and richer overlap detection |
| Fleet | Vehicle, capacity, model, status, service note and dependency-safe deletion | Maintenance work orders, odometer, fuel, tyres, permits and expiry alerts |
| Routes/fares | Routes, fare, distance, duration, boarding point, active/paused state and dependency-safe deletion | Intermediate stops, stop-level inventory and fare history |
| Finance | Admin-only, blurred until administrator password re-check, append-only sale/refund/expense ledger, channel totals and CSV | Approval workflow, accounting export and locked closed-period reporting |
| Expenses | Standalone audited expense entry and history without shift opening or closing | Supervisor approval for large expenses |
| Crew/access | Crew directory, roster assignment, safe deletion and role-scoped staff sign-in accounts | Account disable/reset UI, leave, attendance and document expiry |
| Security/audit | Trusted HTTPS, password hashing, lockout, secure session controls, CSRF, RBAC, security headers and audit log | Centralized logs/alerts and independent penetration test |
| Recovery | Least-privilege app database user, scheduled local SQL backups and tested backup jobs | Encrypted off-machine backups and documented restore drill |

## Controls verified

- Anonymous requests cannot access staff data.
- The public API exposes only active timetable, fleet and occupancy data; it never exposes passenger records.
- Public reservations are unpaid, expire server-side after two hours, and are rate-limited per IP.
- 1Bill cannot be recorded while its server payment mode is disabled.
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
- Automated Node.js/MySQL integration suite: 44 checks passed
- npm production dependency audit: 0 known vulnerabilities
- MySQL backup generation: passed
- Apache staff login, management fallback, assets, and authenticated API endpoints: HTTP 200 as expected; disabled public booking API: intentional HTTP 404
- Headless Chrome checks cover the public site, guarded management route, login, immediate POS access, sidebar scrolling, typography, roster date picking/table actions, master-record deletion, protected finance, staff access and logout

## Before an internet-facing launch

1. Obtain and validate official 1Bill merchant credentials and private integration documentation; implement signed callbacks, idempotency, reconciliation, void/status calls, and provider refunds.
2. Configure a real domain with TLS, set `SESSION_SECURE=true`, restrict `ALLOWED_ORIGINS`, and set production URLs.
3. Schedule encrypted off-machine backups and execute a restore drill on a separate database.
4. Configure centralized error/security monitoring and alerting for API failures, failed logins, database capacity, payment callbacks, and backup failures.
5. Run user acceptance testing with counter, dispatcher, finance, and manager staff; verify printers, terminal network reliability, direct-sale procedures, and refund authority.
6. Add only the next operational controls the client approves: trip cancellation/rebooking, maintenance/permit alerts, crew document expiry, and account disable/reset.

## Operational design references

The Version 2 workflow was checked against official/public operator material: NATCO’s terminal/online ticket terms and passenger operations information, Daewoo’s refund process, and Faisal Movers’ route/date/departure booking flow. These sources support a simple sequence of timetable search, seat selection, passenger identification, payment or reservation, ticket confirmation, manifest/ID reporting and controlled refunds. Provider-specific penalties were not invented; Madina Express should approve its own cancellation and refund policy before it is enforced in code.
