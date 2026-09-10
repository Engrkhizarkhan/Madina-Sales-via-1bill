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
VITE_PUBLIC_BASE=/ VITE_API_BASE=/api VITE_ENABLE_PUBLIC_SITE=false npm run build
npm run server:check
npm run db:install
rsync -a --delete "$PROJECT_DIR/dist/" /var/www/madina-express/
chown -R root:root /var/www/madina-express
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
