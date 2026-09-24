# Madina Express Version 2

A React/TypeScript passenger website and one unified staff workspace backed by Node.js, Express and MySQL/MariaDB. The public website shows the live roster and creates unpaid two-hour seat reservations. Staff can sell tickets immediately, collect an online or counter reservation by cash or card, run dated departures, print tickets and manifests, record refunds and expenses, and manage the roster, buses, routes and crew. There is no shift-opening or shift-closing step.

## Local XAMPP installation

The current machine uses XAMPP at `C:\xamppp`.

1. Copy `backend/.env.example` to `backend/.env` and replace every placeholder value.
2. Keep `PAYMENT_MODE=disabled` until authorized 1Bill credentials and callback specifications are installed. Public reservations and counter cash/card sales continue to work while 1Bill is disabled.
3. Install or update the database:

```powershell
npm run db:install
```

4. Build the frontend:

```powershell
npm install
npm run build
```

5. Start the Node.js API with `npm run server`. It listens on `http://localhost:3101` by default.
6. Expose `dist` as `/madina-express` in Apache. This workstation uses a directory junction under `C:\xamppp\htdocs`.
7. Open `http://localhost/madina-express/`. The first administrator must change the temporary password from System settings.

Never commit `backend/.env`; it contains database and payment secrets.

## Verification

```powershell
npm run build
npm run lint
npm run server:check
npm run test:api
node scripts\browser-smoke.mjs
npm run db:backup
```

The integration suite checks MySQL health, public reservations, dated departure state, immediate counter sales, unique seat protection, staff login, CSRF, refunds, seat release, reservation collection, finance locking, expenses, safe deletion, audit events, staff accounts, logout and role permissions.

## Production controls already implemented

- MySQL transactions and a database-enforced unique active seat per trip run
- Server-derived fare, route, bus, departure, totals, ticket number, and payment state
- Secure password hashes, session cookies, CSRF protection, login lockout, idle timeout, and forced first password change
- Admin, manager, counter, dispatcher, and finance authorization rules
- Admin-only finance and expense pages protected by a 15-minute administrator password re-check
- Full and partial refunds with balance limits, references, immutable ledger rows, audit events, and full-refund seat release
- Dated trip runs keep boarding/departure state separate from the weekly roster, so today’s departure never hides a future trip
- Immediate POS selling, standalone audited expenses, dependency-safe record deletion, server-side reservation expiry, rate-limited public reservations, public passenger-data isolation, security headers, and a tested backup script

## Important release boundary

Real online payments remain intentionally disabled. The public site reserves seats and tells passengers to pay at the counter; it does not simulate a successful 1Bill charge. Production activation requires Madina Express merchant credentials, signed callback validation, reconciliation, status/void calls, and provider-approved refunds.

See [SOFTWARE_AUDIT.md](./SOFTWARE_AUDIT.md) for the detailed audit and remaining operational enhancements.

For a fresh Ubuntu VM without a domain name, use the native Git, Node.js, Nginx and MySQL instructions in [deploy/README.md](./deploy/README.md). Docker is not required.
