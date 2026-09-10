#!/usr/bin/env bash
set -euo pipefail

if [[ ${EUID} -ne 0 ]]; then
  echo "Run this installer with sudo." >&2
  exit 1
fi

if [[ $# -ne 2 ]]; then
  echo "Usage: sudo bash deploy/install-ubuntu.sh SERVER_IP ADMIN_EMAIL" >&2
  exit 1
fi

SERVER_IP=$1
ADMIN_EMAIL=$2
PROJECT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)

if [[ ! $SERVER_IP =~ ^[0-9a-fA-F:.]+$ ]]; then
  echo "The server IP contains invalid characters." >&2
  exit 1
fi
if [[ ! $ADMIN_EMAIL =~ ^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$ ]]; then
  echo "Enter a valid administrator email address." >&2
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y ca-certificates curl git nginx mysql-server openssl rsync xz-utils

ARCH=$(uname -m)
case "$ARCH" in
  x86_64) NODE_ARCH=x64 ;;
  aarch64|arm64) NODE_ARCH=arm64 ;;
  *) echo "Unsupported CPU architecture: $ARCH" >&2; exit 1 ;;
esac

TEMP_DIR=$(mktemp -d)
trap 'rm -rf "$TEMP_DIR"' EXIT
curl -fsSL https://nodejs.org/dist/latest-v22.x/SHASUMS256.txt -o "$TEMP_DIR/SHASUMS256.txt"
NODE_ARCHIVE=$(awk -v arch="$NODE_ARCH" '$2 ~ ("linux-" arch "\\.tar\\.xz$") { print $2; exit }' "$TEMP_DIR/SHASUMS256.txt")
if [[ -z $NODE_ARCHIVE ]]; then
  echo "Could not resolve the current Node.js 22 release." >&2
  exit 1
fi
curl -fsSL "https://nodejs.org/dist/latest-v22.x/$NODE_ARCHIVE" -o "$TEMP_DIR/$NODE_ARCHIVE"
(cd "$TEMP_DIR" && grep " $NODE_ARCHIVE$" SHASUMS256.txt | sha256sum -c -)
NODE_DIRECTORY=${NODE_ARCHIVE%.tar.xz}
if [[ ! -d /opt/$NODE_DIRECTORY ]]; then
  tar -xJf "$TEMP_DIR/$NODE_ARCHIVE" -C /opt
fi
ln -sfn "/opt/$NODE_DIRECTORY" /opt/node-current
ln -sfn /opt/node-current/bin/node /usr/local/bin/node
ln -sfn /opt/node-current/bin/npm /usr/local/bin/npm
ln -sfn /opt/node-current/bin/npx /usr/local/bin/npx

if ! id madina-express >/dev/null 2>&1; then
  useradd --system --home-dir "$PROJECT_DIR" --shell /usr/sbin/nologin madina-express
fi

DB_PASSWORD=$(openssl rand -hex 32)
ADMIN_PASSWORD="Mx!$(openssl rand -hex 18)Aa9"

install -m 0750 -o root -g madina-express -d "$PROJECT_DIR/backend"
cat > "$PROJECT_DIR/backend/.env" <<EOF
APP_ENV=production
APP_URL=http://$SERVER_IP
ALLOWED_ORIGINS=http://$SERVER_IP
DB_HOST=127.0.0.1
DB_PORT=3306
DB_NAME=madina_express
DB_USER=madina_app
DB_PASSWORD=$DB_PASSWORD
SESSION_SECURE=false
PAYMENT_MODE=disabled
PUBLIC_SITE_ENABLED=false
NODE_API_HOST=127.0.0.1
NODE_API_PORT=3101
TRUST_PROXY=1
MYSQL_ADMIN_USER=root
MYSQL_ADMIN_PASSWORD=
MYSQL_ADMIN_SOCKET=/var/run/mysqld/mysqld.sock
ADMIN_NAME=Madina Express Administrator
ADMIN_EMAIL=$ADMIN_EMAIL
ADMIN_USERNAME=admin
ADMIN_PASSWORD=$ADMIN_PASSWORD
ONEBILL_BASE_URL=
ONEBILL_CLIENT_ID=
ONEBILL_CLIENT_SECRET=
ONEBILL_CALLBACK_SECRET=
EOF
chown root:madina-express "$PROJECT_DIR/backend/.env"
chmod 0640 "$PROJECT_DIR/backend/.env"

cd "$PROJECT_DIR"
npm ci
VITE_PUBLIC_BASE=/ VITE_API_BASE=/api VITE_ENABLE_PUBLIC_SITE=false npm run build
npm run server:check
npm run db:install

install -d -m 0755 /var/www/madina-express /var/www/certbot
rsync -a --delete "$PROJECT_DIR/dist/" /var/www/madina-express/
chown -R root:root /var/www/madina-express

sed "s|__PROJECT_DIR__|$PROJECT_DIR|g" "$PROJECT_DIR/deploy/madina-express.service" > /etc/systemd/system/madina-express.service
sed "s|__PROJECT_DIR__|$PROJECT_DIR|g" "$PROJECT_DIR/deploy/madina-express-backup.service" > /etc/systemd/system/madina-express-backup.service
install -m 0644 "$PROJECT_DIR/deploy/madina-express-backup.timer" /etc/systemd/system/madina-express-backup.timer
install -m 0644 "$PROJECT_DIR/deploy/nginx-http.conf" /etc/nginx/sites-available/madina-express
ln -sfn /etc/nginx/sites-available/madina-express /etc/nginx/sites-enabled/madina-express
rm -f /etc/nginx/sites-enabled/default

cat > /root/madina-express-initial-login.txt <<EOF
URL: http://$SERVER_IP
Username: admin
Temporary password: $ADMIN_PASSWORD
EOF
chmod 0600 /root/madina-express-initial-login.txt

systemctl daemon-reload
nginx -t
systemctl enable --now mysql nginx madina-express
systemctl enable --now madina-express-backup.timer
systemctl restart nginx madina-express

curl --fail --silent --show-error http://127.0.0.1:3101/health >/dev/null
curl --fail --silent --show-error http://127.0.0.1/api/health >/dev/null

echo "Madina Express is healthy at http://$SERVER_IP"
echo "Initial login details: /root/madina-express-initial-login.txt"
echo "Next: run sudo bash deploy/enable-ip-tls.sh $SERVER_IP $ADMIN_EMAIL"
