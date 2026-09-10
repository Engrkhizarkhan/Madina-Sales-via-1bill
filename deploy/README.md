# Native Ubuntu VM deployment

This deployment uses Git, Node.js 22, Nginx and a native MySQL server. Docker is not used. Node listens only on `127.0.0.1:3101`; Nginx exposes the application and proxies `/api` on the same IP address. MySQL is not exposed to the network.

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
sudo journalctl -u madina-express -n 100 --no-pager
curl https://SERVER_IP/api/health
```

The IP-address certificate is a trusted, short-lived Let's Encrypt certificate. The included systemd timer checks renewal twice daily and reloads Nginx afterward.
