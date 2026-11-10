#!/usr/bin/env bash
set -euo pipefail
umask 077

if [[ ${EUID} -ne 0 || $# -ne 1 || ! $1 =~ ^[a-z0-9.-]+\.[a-z]+$ ]]; then
  echo 'Usage: sudo bash deploy/configure-production.sh PUBLIC_HOST' >&2
  exit 1
fi

public_host=$1
staff_host="staff.$public_host"
project=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$project"

test -r "/etc/letsencrypt/live/$public_host/fullchain.pem"
test -r backend/.env
ca=/root/madina-terminal-ca
install -d -m 0700 "$ca"
install -d -m 0755 /etc/nginx/madina-terminal-devices
if [[ ! -f $ca/ca.crt ]]; then
  openssl req -new -x509 -newkey rsa:3072 -nodes -days 3650 -sha256 \
    -keyout "$ca/ca.key" -out "$ca/ca.crt" -subj '/CN=Madina Express Terminal Device CA' \
    -addext 'basicConstraints=critical,CA:TRUE,pathlen:0' -addext 'keyUsage=critical,keyCertSign,cRLSign' >/dev/null 2>&1
fi
install -m 0644 "$ca/ca.crt" /etc/nginx/madina-device-ca.crt

if ! grep -q '^ADMIN_TOTP_HEX=' backend/.env; then
  secret=$(openssl rand -hex 20)
  printf '\nADMIN_TOTP_HEX=%s\n' "$secret" >> backend/.env
fi
secret=$(sed -n 's/^ADMIN_TOTP_HEX=//p' backend/.env)
otp=$(printf '%s' "$secret" | xxd -r -p | base32)
cat > /root/madina-express-admin-enrollment.txt <<DETAILS
Staff login: https://$staff_host/login
Username: admin
Temporary password: see /root/madina-express-initial-login.txt
Authenticator: add a time-based key named Madina Express
Authenticator setup key: $otp
DETAILS

sed -i -E '/^(APP_URL|ALLOWED_ORIGINS|SESSION_SECURE|PAYMENT_MODE|PUBLIC_SITE_ENABLED|RESTRICT_STAFF_DEVICES)=/d' backend/.env
cat >> backend/.env <<ENV
APP_URL=https://$public_host
ALLOWED_ORIGINS=https://$public_host,https://$staff_host
SESSION_SECURE=true
PAYMENT_MODE=disabled
PUBLIC_SITE_ENABLED=true
RESTRICT_STAFF_DEVICES=true
ENV
chown root:madina-express backend/.env
chmod 0640 backend/.env
sed -i "s|^URL: .*|URL: https://$staff_host/login|" /root/madina-express-initial-login.txt

install -m 0644 deploy/nginx-production-api.conf /etc/nginx/snippets/madina-api.conf
sed "s/__PUBLIC_HOST__/$public_host/g" deploy/nginx-production-common.conf.template > /etc/nginx/snippets/madina-common.conf
sed -e "s/__PUBLIC_HOST__/$public_host/g" -e "s/__STAFF_HOST__/$staff_host/g" \
  deploy/nginx-production.conf.template > /etc/nginx/sites-available/madina-express
nginx -t

install -d -m 0755 /etc/letsencrypt/renewal-hooks/deploy
printf '#!/bin/sh\nexec /usr/bin/systemctl reload nginx\n' > /etc/letsencrypt/renewal-hooks/deploy/madina-nginx
chmod 0755 /etc/letsencrypt/renewal-hooks/deploy/madina-nginx

# The production host uses the webroot certificate issued by its current Certbot installation.
certbot=$(command -v certbot)
if [[ -x /opt/certbot/bin/certbot ]]; then certbot=/opt/certbot/bin/certbot; fi
cat > /etc/systemd/system/madina-tls-renew.service <<SERVICE
[Unit]
Description=Renew Madina Express HTTPS certificates

[Service]
Type=oneshot
ExecStart=$certbot renew --quiet
SERVICE
cat > /etc/systemd/system/madina-tls-renew.timer <<'TIMER'
[Unit]
Description=Check Madina Express HTTPS certificates twice daily

[Timer]
OnCalendar=*-*-* 03,15:17:00
RandomizedDelaySec=30m
Persistent=true

[Install]
WantedBy=timers.target
TIMER
systemctl daemon-reload
systemctl disable --now certbot.timer
systemctl enable --now madina-tls-renew.timer
systemctl restart madina-express
systemctl reload nginx
