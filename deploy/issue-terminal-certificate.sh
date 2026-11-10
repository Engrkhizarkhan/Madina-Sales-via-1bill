#!/usr/bin/env bash
set -euo pipefail
umask 077

if [[ ${EUID} -ne 0 || $# -ne 2 || ! $1 =~ ^[1-3]$ || ! -f $2 ]]; then
  echo 'Usage: sudo bash deploy/issue-terminal-certificate.sh SLOT (1-3) REQUEST.req' >&2
  exit 1
fi

slot=$1
request=$2
ca=/root/madina-terminal-ca
pins=/etc/nginx/madina-terminal-devices
certificate="$ca/terminal-$slot.cer"
install -d -m 0700 "$ca"
install -d -m 0755 "$pins"
exec 9>"$ca/issue.lock"
flock 9
work=$(mktemp -d "$ca/.issue.XXXXXX")
trap 'rm -rf "$work"' EXIT

if ! openssl req -in "$request" -verify -noout >/dev/null; then
  openssl req -inform DER -in "$request" -out "$work/request.pem"
  request="$work/request.pem"
  openssl req -in "$request" -verify -noout
fi

cat > "$work/client.cnf" <<'EXT'
basicConstraints=critical,CA:FALSE
keyUsage=critical,digitalSignature
extendedKeyUsage=clientAuth
EXT
openssl x509 -req -in "$request" -CA "$ca/ca.crt" -CAkey "$ca/ca.key" \
  -subj "/CN=Madina Express Terminal $slot" -days 365 -sha256 -extfile "$work/client.cnf" -out "$work/client.pem"
fingerprint=$(openssl x509 -in "$work/client.pem" -noout -sha1 -fingerprint | cut -d= -f2 | tr -d ':' | tr '[:upper:]' '[:lower:]')
printf '"SUCCESS:%s" terminal-%s;\n' "$fingerprint" "$slot" > "$work/pin.conf"
pin="$pins/terminal-$slot.conf"
if [[ -f $pin ]]; then cp -- "$pin" "$work/old-pin"; fi
install -m 0644 "$work/pin.conf" "$pin"
if ! nginx -t || ! systemctl reload nginx; then
  if [[ -f $work/old-pin ]]; then install -m 0644 "$work/old-pin" "$pin"; else rm -f -- "$pin"; fi
  exit 1
fi
openssl x509 -in "$work/client.pem" -outform DER -out "$certificate"
printf 'Copy %s back to terminal %s and install it using certreq.\n' "$certificate" "$slot"
