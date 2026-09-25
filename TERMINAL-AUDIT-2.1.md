# Terminal operations 2.1

## Operational changes

- One dated movement record: Scheduled → Boarding → Departed → Returned. Fleet availability follows the recorded departure/return; it is not a second dispatch control.
- Only today's ready bus can board/depart. Active bus/crew conflicts and maintenance/retired buses are blocked. Resolve every unpaid reservation before departure. Return notes and timestamps remain in history.
- Reservations never expire automatically. An operator collects cash/card payment or cancels the hold. Past-date holds remain visible but cannot be converted into tickets for a past departure.
- Refunds remain attached to their original ticket with amount, reason, reference, note and processor. Full refunds release seats. Partial refunds can either keep a valid ticket or explicitly cancel/release seats while retaining the remainder. No invented automatic cancellation fee.
- Booked schedules cannot silently change bus, route, time or crew. Use a new schedule for a changed assignment. Original dated route, bus and passenger snapshots preserve historical manifests.
- Print selects a date and bus, shows searchable ticket records, links to POS to add a passenger, and offers bus detail A4, highway CNIC A4, terminal voucher A4 and 80mm voucher. Previous departures remain selectable. CNIC excludes unpaid reservations; departure passenger snapshots survive later refunds.
- Voucher totals show actual receipts, refunds, net by payment method, reserved seats and tickets added after boarding started. No fabricated deductions or handover totals.
- Public homepage has no hero picture or staff-login link. Availability refreshes from dated departures. Login is simplified; the staff sidebar has no ME badge. Admin finance restrictions remain unchanged.

## Deployment and data safety

- Node.js, MySQL, nginx and systemd; no Docker. Migration 005 is additive and repeatable. It clears expiry only on still-active reservations; it does not restore old cancelled bookings.
- Demo seed data is opt-in (`SEED_DEMO_DATA=true`) so updates cannot recreate deleted default buses/routes.
- Integration tests use dedicated test routes, buses, trips, bookings and users. Cleanup is scoped to those records, not all audit entries after a timestamp.
- Existing pre-snapshot history can only be backfilled from the data still available; previously overwritten details cannot be recovered by this migration.

## Verification

Build, lint, Node syntax checks, MySQL/API integration and Chrome workflow/print checks are run before release. Browser tests include a 40-seat paid booking, two reserved seats and a partial refund. PDFs are rendered for visual inspection, including multi-page tables. Exact final results and deployment status are recorded in the delivery message.

## Remaining operational decisions

- 1Bill remains disabled until actual gateway credentials and verified callbacks are configured. Card entries record a payment received on the terminal; this software does not charge a card itself.
- Management must confirm its commercial refund fees/cutoffs; the application does not invent them.
- A physical printer test is still needed for the client's exact A4 and 80mm drivers/cutter settings.
- Backups on the same VM are not disaster recovery: copy them to separate storage and rehearse a restore.
- This is a targeted code, workflow, integration and UI audit, not a penetration-test or guarantee of zero defects. All-history bootstrap loading should be paginated as the database grows.
