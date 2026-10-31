# Node.js backend

The active Madina Express API is implemented with Node.js, Express and MySQL/MariaDB. It listens on `http://localhost:3101` by default and keeps all operational data in the XAMPP MariaDB instance.

## Commands

Run these from the project root:

```powershell
npm install
npm run db:install
npm run server
```

In a second terminal, verify the API:

```powershell
npm run server:check
npm run test:api
npm run db:backup
```

Configuration is loaded from `backend/.env`. Copy `backend/.env.example` for a new installation and replace its secrets before use. The browser client is disabled until the 1Bill integration is configured.

The older PHP files are retained only as a rollback/reference copy. The frontend, database installer, backup utility, and automated integration suite now target the Node.js backend.

### Counter controls and client demo (1 November 2026)

Apply `006_counter_controls.sql` before starting this release. Use an administrative MySQL connection; the application account intentionally has no schema privileges:

```sh
MYSQL_ADMIN_SOCKET=/var/run/mysqld/mysqld.sock npm run db:migrate -- 006_counter_controls.sql
```

Schedules, bus layouts, routes and crew are removed from working lists with a deletion timestamp. Existing ticket/ledger references and dated snapshots remain available. Recurring roster edits affect future unmaterialized departures; existing dated snapshots keep their original assignment. Bus setup stores reusable names, service classes and seat capacities (`is_template=1`). Actual vehicle registration is entered and saved on the ticket page. Counter ticket issuance requires that vehicle assignment.

Ticket-page controls pause/resume a dated seat map, record departure directly without a boarding step, and confirm release of unpaid holds. Reopening departed counter sales requires an explicit confirmation and a recorded reason; public checkout remains closed. Dispatcher accounts can manage departure and vehicle assignment but cannot issue tickets or save voucher expenses.

`PAYMENT_MODE=demo` makes public checkout issue confirmed simulated 1Bill tickets, with server-generated `DEMO-1BILL-` references and matching sales ledger rows. No gateway request or real charge occurs. Other payment modes reject public checkout until the actual gateway adapter is implemented. Counter reservations remain supported. Every seat receives its own ticket number and boarding token.

The client-demo reset is a separate, destructive operator command. **Back up the database first and stop the API during replacement.** It replaces operational tables with synthetic routes, layouts, vehicles, crew, dated runs, tickets, refunds and expenses, while preserving users and login sessions:

```sh
PAYMENT_MODE=demo DEMO_DATA_RESET_ALLOWED=true node backend/scripts/client-demo.js --reset-demo
```

Do not run it as part of routine migrations or future deployments. The reset flag is supplied only to this command and should not be saved in the service environment. The script generates dates relative to the current Pakistan date and records an audit event identifying the dataset as synthetic.
