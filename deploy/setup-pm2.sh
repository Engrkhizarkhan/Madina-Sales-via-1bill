#!/usr/bin/env bash
set -euo pipefail

if [[ ${EUID} -ne 0 ]]; then
  echo "Run this setup with sudo." >&2
  exit 1
fi
PROJECT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
PM2_VERSION=7.0.4
INSTALLED_VERSION=$(/opt/node-current/bin/node -p "try { require('/opt/node-current/lib/node_modules/pm2/package.json').version } catch { '' }")
if [[ $INSTALLED_VERSION != "$PM2_VERSION" ]]; then
  /opt/node-current/bin/npm install --global "pm2@$PM2_VERSION"
fi
install -d -m 0750 -o madina-express -g madina-express /var/lib/madina-express /var/lib/madina-express/.pm2 /var/log/madina-express
install -m 0755 "$PROJECT_DIR/deploy/madina-pm2" /usr/local/bin/madina-pm2
install -m 0644 "$PROJECT_DIR/deploy/pm2-logrotate.conf" /etc/logrotate.d/madina-express

# Preserve the current service as a rollback before the first PM2 migration.
if [[ -f /etc/systemd/system/madina-express.service ]] && ! grep -q 'PM2' /etc/systemd/system/madina-express.service; then
  install -d -m 0700 /var/backups/madina-express/deployment
  cp -p /etc/systemd/system/madina-express.service /var/backups/madina-express/deployment/madina-express-pre-pm2.service
fi
# Stop using the currently loaded unit before replacing it (its stop command differs).
if [[ -f /etc/systemd/system/madina-express.service ]]; then
  systemctl stop madina-express.service
fi
sed "s|__PROJECT_DIR__|$PROJECT_DIR|g" "$PROJECT_DIR/deploy/madina-express.service" > /etc/systemd/system/madina-express.service
systemctl daemon-reload
systemctl enable --now madina-express.service

for attempt in {1..30}; do
  if curl --fail --silent http://127.0.0.1:3101/health >/dev/null; then
    /usr/local/bin/madina-pm2 save
    echo "PM2 is supervising Madina Express; startup and log rotation are configured."
    exit 0
  fi
  sleep 1
done
systemctl status madina-express --no-pager --full || true
echo "PM2 health check failed. Inspect sudo madina-pm2 logs --nostream." >&2
exit 1
