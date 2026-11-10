# Native Ubuntu VM deployment

This deployment uses Git, Node.js 22 supervised by PM2, Nginx and a native MySQL server. Docker is not used. Node listens only on `127.0.0.1:3101`; Nginx exposes the application and proxies `/api` on the same IP address. MySQL is not exposed to the network.

## Recommended VM

- Ubuntu 22.04 LTS or 24.04 LTS
- Static public IPv4 address
- 2 CPU cores, 4 GB RAM and at least 30 GB SSD
- In the provider firewall, allow TCP 22, 80 and 443; do not allow TCP 3306

## First installation

```bash
sudo apt-get update
sudo apt-get install -y git
sudo git clone https://github.com/Engrkhizarkhan/Madina-Sales-via-1bill.git /opt/madina-express
cd /opt/madina-express
sudo bash deploy/install-ubuntu.sh SERVER_IP YOUR_ADMIN_EMAIL
sudo bash deploy/enable-ip-tls.sh SERVER_IP YOUR_ADMIN_EMAIL
```

If a certificate contact email is not available, pass `-` as the second argument. A real monitored address is preferred for expiry and account notices.

The installer creates random database and temporary administrator passwords. The initial administrator login is saved root-only at `/root/madina-express-initial-login.txt`. Sign in over HTTPS and change it immediately.

The installer also enables a daily MySQL backup timer. Backups are written to `/var/backups/madina-express`; copy them to separate storage so a VM failure cannot remove both the live database and its backups.

## Updates

```bash
cd /opt/madina-express
sudo bash deploy/update.sh
```

The update stops when the server checkout has local changes and only accepts a fast-forward update from `main`.

## Backups

Run a manual backup with:

```bash
sudo bash deploy/backup.sh
```

Backups are written under `/var/backups/madina-express`. Copy them to another machine or storage provider. The timer files can be installed to run this automatically each night.

## Useful checks

```bash
sudo systemctl status madina-express nginx mysql
sudo madina-pm2 status
sudo madina-pm2 logs madina-express --lines 100 --nostream
sudo madina-pm2 monit
sudo journalctl -u madina-express -n 100 --no-pager
curl https://SERVER_IP/api/health
```

The IP-address certificate is a trusted, short-lived Let's Encrypt certificate. The included systemd timer checks renewal twice daily and reloads Nginx afterward.

## PM2 operation

PM2 7.0.4 runs as the unprivileged `madina-express` user. Use `pm2 list`, `pm2 logs madina-express`, or `sudo madina-pm2`; the installed `/usr/local/bin/pm2` wrapper delegates through sudo to the same service account and targets `/var/lib/madina-express/.pm2`. Existing sudo permissions apply. Avoid invoking `/opt/node-current/bin/pm2` directly from your SSH user, as that targets a different daemon. The `madina-express` systemd service starts PM2 and the versioned ecosystem configuration at boot, and restarts the manager if it fails. PM2 restarts the app after a crash with a three-second delay and a 250 MB memory threshold. After 20 rapid startup failures it stops retrying; inspect logs and correct the cause before restarting.

One fork-mode process is intentional for the small VM and in-memory public-reservation throttling. Restarting causes a short API interruption; this is not a high-availability cluster. The graceful shutdown timeout allows in-flight requests to finish. Daily log rotation retains seven compressed rotations; logs are checked for size at each logrotate run. Credentials remain in `backend/.env`, not the ecosystem file.

```bash
# Migrate an existing installation without rebuilding or touching the database:
sudo bash deploy/setup-pm2.sh
# Restart the API after a configuration change:
sudo systemctl reload madina-express
```

The first migration saves the previous direct-Node service at `/var/backups/madina-express/deployment/madina-express-pre-pm2.service`. To roll back the supervisor only:

```bash
sudo systemctl stop madina-express
sudo cp /var/backups/madina-express/deployment/madina-express-pre-pm2.service /etc/systemd/system/madina-express.service
sudo systemctl daemon-reload
sudo systemctl start madina-express
```

Future `deploy/update.sh` runs use PM2 again. PM2 startup/background: [official documentation](https://pm2.keymetrics.io/docs/usage/startup/).

## Production access

The public portal is at [Madina Express](https://madinaexpress.duckdns.org). Staff sign in at [Staff sign-in](https://staff.madinaexpress.duckdns.org/login). Production uses the separate HTTPS virtual hosts in `nginx-production.conf.template`. Only the public reservation APIs are exposed on the passenger host.

The main administrator signs in with username `admin`, a password, and a six-digit authenticator code. Initial enrollment details and the temporary password are in root-only files on the VPS. Retrieve them through SSH and change the temporary password after the first sign-in. Store the authenticator recovery key separately.

```bash
ssh root@62.171.173.11 'cat /root/madina-express-admin-enrollment.txt /root/madina-express-initial-login.txt'
```

The main administrator can create staff accounts under **Settings**. Staff require a certificate from one of the three enrolled terminal PCs for login and subsequent authenticated requests.

### Enroll a terminal PC

1. Copy `Madina-Express-Terminal-Setup.inf` to the terminal PC. While signed in to the Windows account used for ticketing, open Command Prompt in that folder and run `certreq -new -user Madina-Express-Terminal-Setup.inf terminal.req`. The private key stays in that Windows user's TPM. Enrollment requires a working TPM and a Chromium browser using the same Windows account.
2. Retrieve `terminal.req` directly from that PC and transfer the request to the server via SSH. Use slot 1, 2, or 3. Verify which PC produced the request before signing it.

   ```bash
   scp terminal.req root@62.171.173.11:/root/terminal-1.req
   ssh root@62.171.173.11 'cd /opt/madina-express && bash deploy/issue-terminal-certificate.sh 1 /root/terminal-1.req'
   scp root@62.171.173.11:/root/madina-terminal-ca/terminal-1.cer terminal-1.cer
   ```

3. Return the certificate to the same PC and Windows account, then run `certreq -accept -user terminal-1.cer`. Restart the counter browser and choose the Madina Express terminal certificate when prompted at staff sign-in.
4. Repeat for the other two slots. In Firefox on the enrolled Windows account, enable `security.osclientcerts.autoload` in `about:config` if Firefox does not list the terminal certificate. Enrolling a replacement in a slot overwrites that slot's previous certificate pin. To revoke access, remove the relevant `/etc/nginx/madina-terminal-devices/terminal-N.conf` on the server, run `nginx -t`, and reload Nginx.

### Backup retention

The daily backup runs around 02:30 Pakistan time. It verifies the gzip file before publishing it and removes local database backups older than 30 days. Store important backups outside the VPS if you need to recover from loss of the machine.
