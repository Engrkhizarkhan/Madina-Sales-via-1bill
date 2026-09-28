# Counter update — 28 September 2026

- Removed failed-login account lockouts. Invalid credentials still return a normal error; password hashing, sessions, CSRF, role permissions and public reservation anti-spam protection remain in place.
- Reset the existing admin account's password as explicitly requested for testing, cleared its lock and revoked prior sessions. No user or business records were deleted. The password is not stored in source code and remains bcrypt-hashed in MySQL. Replace the weak testing password before real use.
- Sell ticket now defaults to the roster's bus, driver, attendant, departure time and platform, with editable selectors/fields. Save trip changes applies only to the chosen date, not every recurrence.
- Updating an open departure also updates its active tickets, keeping seats and amounts unchanged. The operator is prompted to reprint affected tickets and inform passengers. Closed/cancelled/refunded records are not rewritten.
- Replacement buses must be ready and large enough for existing seat numbers. Changed crew must exist in Crew and not be off duty. Conflicting assignments, closed departures and stale operator edits are rejected. Assignment changes are audited.
- Counter staff can use this without getting permission to edit the permanent roster or unlock finance.

Validation: production build, lint and Node syntax checks passed. The expanded 80-check API suite passed on the VM, including seven incorrect-password attempts followed by successful login, existing legacy-lock handling, assignment changes, seat safety, ticket synchronization and counter permissions. Live browser checks include default assignment values, saving a date-only change and verifying that the recurring roster remains untouched. Tests use disposable records and scoped cleanup.
