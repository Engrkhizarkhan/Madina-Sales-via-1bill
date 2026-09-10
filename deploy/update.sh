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
npm ci
VITE_PUBLIC_BASE=/ VITE_API_BASE=/api VITE_ENABLE_PUBLIC_SITE=false npm run build
npm run server:check
npm run db:install
rsync -a --delete "$PROJECT_DIR/dist/" /var/www/madina-express/
chown -R root:root /var/www/madina-express
systemctl restart madina-express
nginx -t
systemctl reload nginx
curl --fail --silent --show-error http://127.0.0.1:3101/health >/dev/null
echo "Madina Express was updated successfully."
