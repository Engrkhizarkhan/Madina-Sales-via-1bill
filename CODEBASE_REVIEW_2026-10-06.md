# Madina Express development baseline

Reviewed 6 October 2026, Asia/Karachi. Release 2.1.0, commit `1fe5a0e`.

## Outcome and scope

Reviewed the active frontend workflows, API routes and authorization, booking and movement operations, data access and schema/migrations, printing and finance calculations, deployment/backup scripts, test coverage, and live server supervision. Inspected the retained PHP implementation as legacy reference; production uses Node.js. This is a development baseline and targeted correctness review, not a claim that every UI state or failure mode has been tested.

The local checkout was seven commits behind production. It was clean and was fast-forwarded from `4495ae4` to `1fe5a0e`, matching GitHub main and the clean server checkout. No application behavior was changed during this review.

## System map

| Area | Main files | Responsibility |
| --- | --- | --- |
| Frontend | `src/App.tsx`, `src/App.css`, `src/index.css` | React/TypeScript public reservations and staff workspace; responsive styles, A4 and 80mm printing |
| API client | `src/api.ts` | Cookie-authenticated requests, CSRF token storage, typed endpoint wrappers |
| HTTP API | `backend/node/app.js` | Express routes, security headers, sessions, authorization, finance unlock, error responses |
| Business rules | `backend/node/operations.js` | Booking, collection, refunds, roster, dated assignments, movement, expenses, staff accounts and audit events |
| Departure lifecycle | `backend/node/departures.js` | Creates dated snapshots and checks whether ticket sales remain open |
| Persistence | `backend/node/repository.js`, `db.js`, `helpers.js` | MySQL queries, transaction handling, output mapping and Pakistan time helpers |
| Data installation | `backend/database/schema.sql`, `backend/database/migrations/`, `backend/scripts/install.js` | Schema and repeatable migrations; demo seeding is opt-in |
| Production | `deploy/` | Nginx/TLS, PM2 under systemd, installation, updates and scheduled SQL backups |
| Verification | `backend/tests/integration.js`, `scripts/browser-smoke.mjs`, `scripts/qa-server.mjs` | API suite, browser workflow suite and local same-origin QA server |
| Legacy | `backend/src/`, `backend/public/index.php`, PHP scripts/tests | Older PHP version; differs from current business rules and should not be treated as a drop-in rollback |

The main UI remains concentrated in a 6,401-line component file and 5,886-line stylesheet. Feature work will usually touch `App.tsx`, the client wrapper, an Express endpoint, an operation and its repository/schema support.

## Current business behavior

- Public reservations and counter tickets share the database-enforced active-seat constraint for each dated departure.
- Reservations remain until staff collect payment or cancel them; they no longer expire after two hours.
- Cash/card/bank entries record payments received. The application does not charge cards itself. Live 1Bill integration remains disabled.
- Weekly schedules and dated departures are separate. Dated bus/crew/time/platform overrides can update active tickets without rewriting the recurring schedule.
- Movement follows Scheduled → Boarding → Departed → Returned. Unpaid reservations must be resolved before departure. Departure snapshots preserve passenger history after later refunds.
- Refunds have an append-only record and financial ledger entry. A full refund releases seats; a partial refund may explicitly cancel the ticket and release its seats.
- Admin, manager, counter, dispatcher and finance roles have endpoint-specific permissions. Finance/expenses have an additional administrator password prompt, with limitations below.
- A4 bus details, highway CNIC sheets, A4 terminal vouchers, 80mm vouchers and ticket receipts are rendered by the browser. Identity is recorded per booking, so group bookings repeat that identity for every seat.

## Confirmed findings

### P1 — Existing departure snapshots can sell seats beyond a reduced bus capacity

`backend/node/operations.js`, `createBooking` and `saveBus`; `backend/node/departures.js`, `ensureRun`.

Reproduced in an isolated database: create a five-seat bus, sell seat 1 for a future departure, change the bus capacity to two, then sell seat 3 for that same departure. Both the capacity change and invalid seat sale succeed. `saveBus` checks existing occupied seats but leaves the scheduled run's five-seat snapshot unchanged; `createBooking` validates against that snapshot.

Future fix: validate new seat sales against the authoritative current capacity or safely reconcile open-run snapshots when capacity changes, while retaining closed historical snapshots. Add a regression test for this sequence.

### P1 — Finance password gate does not protect the underlying payment data

`backend/node/app.js`, `/admin/bootstrap`; `src/App.tsx`, `FinanceProtected` and `FinanceView`.

Reproduced while `/finance/status` returned `unlocked: false`: bootstrap still returned the complete booking payment values used to calculate finance totals. Bootstrap is available to authenticated staff, and only its user-administration list is role-filtered. Expenses do have server-side unlock checks; the booking-derived finance view is a frontend gate.

Source inspection also shows `financeUnlocked` is set to true without a timeout/recheck, so the finance UI does not relock after the advertised 15 minutes. Decide which ticket-level amounts each operational role needs, then restrict aggregate finance/history data at the server and enforce unlock expiry in the UI.

### P2 — Password changes leave other authenticated sessions valid

`backend/node/app.js`, `/auth/change-password`.

Reproduced with two sessions: changing the password in session A leaves session B able to call `/auth/me`. The operation updates only the current session's CSRF token and finance-unlock value. Future fix: revoke the user's other sessions transactionally when changing the password.

### P2 — Automatic refresh prevents the advertised idle timeout

`backend/node/app.js`, `loadSession`; `src/App.tsx`, `ManagementApp` refresh effect.

Every authenticated request extends expiry by eight hours. The staff page fetches bootstrap every 30 seconds, regardless of operator interaction. Reproduced that a bootstrap call extends a session set to expire in one minute back to approximately eight hours. An unattended open tab can therefore keep its session alive. Separate user activity from background refresh, and/or enforce an absolute session lifetime.

## Additional findings from source and configuration

- **Login protection:** failed-login lockouts were deliberately removed in commit `6a8eebc` for client testing. There is no replacement login limiter in the inspected Express code or deployment Nginx template. The old audit's lockout claim is obsolete. The September counter note mentions a testing password; this review did not retrieve or attempt that password.
- **History loading:** staff bootstrap retrieves all bookings and all trip runs every 30 seconds. Each booking also causes separate seat and refund queries. Pagination, date filtering and batched queries will matter as history grows.
- **Date rollover:** frontend `today` is calculated once at module load. A terminal tab left open across Pakistan midnight retains the previous day in defaults/comparisons until reloaded.
- **Finance dates:** the finance chart and sale CSV use travel date/time for collected sales, while refund entries use processing date/time. They do not represent a consistent cash-receipt ledger; the period selector changes chart buckets, while headline totals remain all-time.
- **Validation and editing:** several master-record writes and audit inserts are separate operations; some edit dialogs close without awaiting successful saves. Review those paths when changing management forms.
- **Documentation drift:** root README and the older software audit describe expired reservations and login lockouts. `TERMINAL-AUDIT-2.1.md`, `COUNTER-UPDATE-2026-09-28.md` and current source better describe the deployed behavior.
- **Recovery:** nightly backups are on the same VM. Off-machine copies, retention policy and a restore drill were not verified. Update scripts do not take an explicit pre-migration backup or perform an atomic release switch.
- **Debugging coverage:** PM2 captures application stdout/stderr. Existing logging is principally startup/shutdown and unexpected exceptions; request IDs and structured request/business-event logs are not implemented. Nginx logs and database audit events complement PM2 logs.

## Server and PM2

- SSH: `khizarkhanVM@20.187.97.214`
- Application checkout: `/opt/madina-express`
- Public website: `https://20.187.97.214`
- API: Nginx `/api/` → `127.0.0.1:3101/`; direct health is `/health`, public health is `/api/health`.
- Static frontend: `/var/www/madina-express`
- Database: native MySQL, loopback only
- Node: 22.23.2; PM2: 7.0.4
- PM2 process: `madina-express`, owned by the `madina-express` service account
- PM2 home: `/var/lib/madina-express/.pm2`
- Boot supervision: enabled `madina-express.service`, which starts the versioned ecosystem file. A separate `pm2-madina-express.service` is not required.
- Crash restart: enabled, three-second delay; 250 MB memory threshold; 20 rapid startup failures before PM2 stops retrying.
- App logs: `/var/log/madina-express/app-out.log` and `app-error.log`; logrotate covers these and the PM2 manager log.
- Nightly backup timer: enabled; latest inspected job exited successfully.
- TLS renewal timer: enabled; current certificate was valid when checked.

PM2 was already installed and supervising the app when this review began, since 28 September. No migration or production restart was necessary. The production PID remained 394989, with zero PM2 restarts, across the review.

Use the wrapper so commands address the service account's existing PM2 daemon:

```bash
ssh khizarkhanVM@20.187.97.214
sudo madina-pm2 status
sudo madina-pm2 logs madina-express --lines 100
sudo madina-pm2 logs madina-express --err --lines 100 --nostream
sudo madina-pm2 monit
sudo journalctl -u madina-express -n 100 --no-pager
sudo tail -n 100 /var/log/nginx/error.log
curl -fsS https://20.187.97.214/api/health
```

When a restart is needed after an approved deployment or configuration change:

```bash
sudo systemctl reload madina-express
```

This uses the unit's PM2 restart command and briefly interrupts the single API process.

Follow-up on 6 October: installed `/usr/local/bin/pm2` as a convenience wrapper after the SSH user encountered `pm2: command not found`. Both `pm2 list` and `pm2 logs madina-express` now address the existing service-account daemon through sudo. Verified these commands and HTTPS health without restarting production. The local deployment setup now installs this wrapper too; those repository edits have not been committed or pushed. Avoid directly invoking `/opt/node-current/bin/pm2` under the SSH user, which targets a separate daemon.

## Verification performed this review

| Check | Result |
| --- | --- |
| Production frontend build | Passed |
| ESLint | Passed; current lint configuration targets TypeScript/frontend files |
| Backend syntax command | Passed |
| Existing API integration suite | All 80 checks passed on an isolated temporary database and loopback API |
| Four targeted defect reproductions | Confirmed capacity, finance-data access, password-session and polling-expiry behaviors above |
| Production dependency audit | No known vulnerabilities reported for production dependencies at review time |
| Public HTTPS health and direct backend health | Healthy; database connected; payment mode disabled |
| Nginx configuration | Valid |
| PM2 process and boot configuration | Online, enabled, zero app restarts |
| Log rotation configuration | Dry-run validated |
| Test cleanup | Temporary APIs, databases and database users removed; production database was not used for tests |

Browser interaction tests, new print/PDF visual checks, physical printers, forced production crash/reboot recovery, and a backup restore were not run during this review. Older release notes contain historical browser/print results; they are not new verification evidence.

## Starting the next development request

Use this synchronized release as the baseline. Address changes in the active Node implementation, preserve dated snapshots and financial/audit history, and test against an isolated database. The confirmed findings above remain unfixed pending the next development scope. No credentials or passenger records were copied into this report.
