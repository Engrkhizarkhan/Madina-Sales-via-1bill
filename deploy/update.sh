#!/usr/bin/env bash
set -euo pipefail

if [[ ${EUID} -ne 0 ]]; then
  echo "Run this updater with sudo." >&2
  exit 1
fi

PROJECT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$PROJECT_DIR"

if [[ -n $(git status --porcelain) ]]; then
  echo "The server checkout has local changes; update stopped to protect them." >&2
  exit 1
fi

git pull --ff-only origin main
timedatectl set-timezone Asia/Karachi
if ! cmp -s "$PROJECT_DIR/deploy/mysql.cnf" /etc/mysql/mysql.conf.d/madina-express.cnf; then
  install -m 0644 "$PROJECT_DIR/deploy/mysql.cnf" /etc/mysql/mysql.conf.d/madina-express.cnf
  systemctl restart mysql
fi
npm ci
VITE_PUBLIC_BASE=/ VITE_API_BASE=/api VITE_ENABLE_PUBLIC_SITE=true npm run build
npm run server:check
npm run db:install
if grep -q '^PUBLIC_SITE_ENABLED=' "$PROJECT_DIR/backend/.env"; then
  sed -i 's/^PUBLIC_SITE_ENABLED=.*/PUBLIC_SITE_ENABLED=true/' "$PROJECT_DIR/backend/.env"
else
  printf '\nPUBLIC_SITE_ENABLED=true\n' >> "$PROJECT_DIR/backend/.env"
fi
rsync -a --delete "$PROJECT_DIR/dist/" /var/www/madina-express/
chown -R root:root /var/www/madina-express
sed "s|__PROJECT_DIR__|$PROJECT_DIR|g" "$PROJECT_DIR/deploy/madina-express.service" > /etc/systemd/system/madina-express.service
sed "s|__PROJECT_DIR__|$PROJECT_DIR|g" "$PROJECT_DIR/deploy/madina-express-backup.service" > /etc/systemd/system/madina-express-backup.service
install -m 0644 "$PROJECT_DIR/deploy/madina-express-backup.timer" /etc/systemd/system/madina-express-backup.timer
systemctl daemon-reload
systemctl enable --now madina-express-backup.timer
systemctl restart madina-express
nginx -t
systemctl reload nginx

attempt=0
until curl --fail --silent http://127.0.0.1:3101/health >/dev/null; do
  attempt=$((attempt + 1))
  if [[ $attempt -ge 30 ]]; then
    systemctl status madina-express --no-pager --full || true
    echo "The updated Node.js API did not become healthy in time." >&2
    exit 1
  fi
  sleep 1
done
echo "Madina Express was updated successfully."
