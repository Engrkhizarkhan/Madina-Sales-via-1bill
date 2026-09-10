# Madina Express Operations Suite

A React/TypeScript transport operations interface backed by Node.js, Express and MySQL/MariaDB. The counter POS is the current entry point, with workflows for paid tickets, reservations, refunds, expenses, trips, dispatch, fleet, routes, protected finance, reports, crew, and role-based staff access. Staff can start selling immediately after sign-in; there is no shift-opening or shift-closing step. The client website is intentionally hidden until 1Bill is configured.

## Local XAMPP installation

The current machine uses XAMPP at `C:\xamppp`.

1. Copy `backend/.env.example` to `backend/.env` and replace every placeholder value.
2. Keep `PAYMENT_MODE=disabled` for real environments until authorized 1Bill credentials and callback specifications are installed. Use `demo` only for local testing.
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

The integration suite checks MySQL health, anonymous access denial, the disabled public site, immediate paid counter booking creation, unique seat protection, staff login, CSRF, refunds, seat release, reservations, finance locking/unlocking, expenses, safe route/bus/trip/crew deletion, audit events, staff-account creation, logout, and role permissions.

## Production controls already implemented

- MySQL transactions and a database-enforced unique active seat per trip run
- Server-derived fare, route, bus, departure, totals, ticket number, and payment state
- Secure password hashes, session cookies, CSRF protection, login lockout, idle timeout, and forced first password change
- Admin, manager, counter, dispatcher, and finance authorization rules
- Admin-only finance and expense pages protected by a 15-minute administrator password re-check
- Full and partial refunds with balance limits, references, immutable ledger rows, audit events, and full-refund seat release
- Immediate POS selling, standalone audited expenses, dependency-safe record deletion, server-side reservation expiry, public passenger-data isolation, security headers, and a tested backup script

## Important release boundary

The application is operational locally, but real online payments remain intentionally disabled by default. Production 1Bill activation requires Madina Express merchant credentials, the provider's private request/signature fields, signed callback validation, reconciliation, and void/refund endpoint approval. The code does not invent or simulate those credentials in production.

See [SOFTWARE_AUDIT.md](./SOFTWARE_AUDIT.md) for the detailed audit and remaining operational enhancements.

For a fresh Ubuntu VM without a domain name, use the native Git, Node.js, Nginx and MySQL instructions in [deploy/README.md](./deploy/README.md). Docker is not required.
