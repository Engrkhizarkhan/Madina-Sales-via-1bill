#!/usr/bin/env bash
set -euo pipefail

if [[ ${EUID} -ne 0 ]]; then
  echo "Run this command with sudo." >&2
  exit 1
fi
if [[ $# -ne 2 ]]; then
  echo "Usage: sudo bash deploy/enable-ip-tls.sh SERVER_IP ADMIN_EMAIL" >&2
  exit 1
fi

SERVER_IP=$1
ADMIN_EMAIL=$2
PROJECT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)

if [[ ! $SERVER_IP =~ ^[0-9a-fA-F:.]+$ ]]; then
  echo "The server IP contains invalid characters." >&2
  exit 1
fi

apt-get update
apt-get install -y python3-venv
if [[ ! -x /opt/certbot/bin/certbot ]]; then
  python3 -m venv /opt/certbot
fi
/opt/certbot/bin/pip install --upgrade 'certbot>=5.4,<6'

/opt/certbot/bin/certbot certonly \
  --non-interactive \
  --agree-tos \
  --email "$ADMIN_EMAIL" \
  --preferred-profile shortlived \
  --webroot \
  --webroot-path /var/www/certbot \
  --ip-address "$SERVER_IP"

sed "s/__SERVER_IP__/$SERVER_IP/g" "$PROJECT_DIR/deploy/nginx-https.conf.template" > /etc/nginx/sites-available/madina-express

sed -i "s|^APP_URL=.*|APP_URL=https://$SERVER_IP|" "$PROJECT_DIR/backend/.env"
sed -i "s|^ALLOWED_ORIGINS=.*|ALLOWED_ORIGINS=https://$SERVER_IP|" "$PROJECT_DIR/backend/.env"
sed -i "s|^SESSION_SECURE=.*|SESSION_SECURE=true|" "$PROJECT_DIR/backend/.env"

cat > /etc/systemd/system/certbot-ip-renew.service <<'EOF'
[Unit]
Description=Renew the Madina Express IP-address TLS certificate
After=network-online.target nginx.service

[Service]
Type=oneshot
ExecStart=/opt/certbot/bin/certbot renew --quiet
ExecStartPost=/usr/bin/systemctl reload nginx
EOF

cat > /etc/systemd/system/certbot-ip-renew.timer <<'EOF'
[Unit]
Description=Check the Madina Express IP-address TLS certificate twice daily

[Timer]
OnCalendar=*-*-* 03,15:17:00
RandomizedDelaySec=30m
Persistent=true

[Install]
WantedBy=timers.target
EOF

systemctl daemon-reload
nginx -t
systemctl enable --now certbot-ip-renew.timer
systemctl restart nginx madina-express
curl --fail --silent --show-error "https://$SERVER_IP/api/health" >/dev/null
echo "Trusted HTTPS is active at https://$SERVER_IP"
