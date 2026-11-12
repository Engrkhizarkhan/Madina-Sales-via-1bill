# Hosting multiple backends on the VPS

Madina Express is isolated by its service account, database, ports, Nginx hosts, PM2 home and backups. Add another backend as a separate application, rather than placing its files or credentials in Madina directories.

| Purpose | Madina Express location |
|---|---|
| Source/recovery checkout | `/opt/madina-express` |
| Active release pointer | `/var/lib/madina-express/host/current.json` |
| Active application symlink | `/var/lib/madina-express/current` |
| Verified application versions | `/var/lib/madina-express/releases` |
| Protected configuration | `/etc/madina-express` |
| Package channel and public ZIPs | `/var/lib/madina-express/updates` |
| Writable app control state | `/var/lib/madina-express/updates/control` |
| Logs | `/var/log/madina-express`, journald |
| Backups | `/var/backups/madina-express` |
| Runtime/download cache | `/var/cache/madina-express` |
| Website files | `/var/www/madina-express` |
| Private API port | `127.0.0.1:3101` |
| Source tunnel ports | `127.0.0.1:3201`, `127.0.0.1:13306` |

For another app, create its own Linux service user, `/opt/<app>`, `/etc/<app>`, `/var/lib/<app>`, `/var/log/<app>` and `/var/backups/<app>`. Give it a separate MySQL database/user and an unused loopback API port. Add explicit domain-based Nginx server blocks and HTTPS. Run a separate systemd/PM2 service with its own `PM2_HOME`; restart only that app. The convenience `madina-pm2` command is specific to Madina; another app should use its own wrapper or the actual PM2 binary with its own home.

Keep each app's runtime version explicit. Do not expose database/API/tunnel ports publicly, share writable application directories, or use a root-running API. Release signatures, keys and CI secrets belong to each application separately.

Retain useful recovery versions and backups. Remove temporary QA environments and obsolete runtime downloads only after testing; do not delete database files, TLS keys, system directories, or another application's data as generic cleanup.
