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
