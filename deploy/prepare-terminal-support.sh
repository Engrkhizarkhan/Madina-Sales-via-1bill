#!/usr/bin/env bash
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo 'Run as root.' >&2; exit 1; }
PROJECT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
STATE_DIR=/var/lib/madina-express/terminal
install -d -m 0750 -o root -g madina-express "$STATE_DIR"
apt-get install -y zip >/dev/null
install -m 0755 -o root -g root "$PROJECT_DIR/deploy/terminal-control.py" /usr/local/libexec/madina-terminal-control
install -m 0640 -o root -g madina-express "$PROJECT_DIR/deploy/nginx-terminal.conf.template" "$STATE_DIR/nginx-terminal.conf.template"
if ! id madina-terminal >/dev/null 2>&1; then
  useradd --system --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin madina-terminal
  usermod --password '*NP*' madina-terminal
fi
cat > /usr/local/libexec/madina-terminal-authorized-key <<'PY'
#!/usr/bin/python3
import json, pathlib, re
path = pathlib.Path('/var/lib/madina-express/terminal/private.json')
if path.exists():
    config = json.loads(path.read_text())
    key = config.get('publicKey', '')
    if re.fullmatch(r'ssh-ed25519 [A-Za-z0-9+/=]{50,100}(?: [A-Za-z0-9._ -]{1,100})?', key):
        print('restrict,port-forwarding,permitlisten="127.0.0.1:3201",permitlisten="127.0.0.1:13306",command="/bin/false" ' + key)
PY
chmod 0755 /usr/local/libexec/madina-terminal-authorized-key
cat > /etc/ssh/madina-terminal.conf <<'SSH'
Match User madina-terminal
    AuthorizedKeysFile none
    AuthorizedKeysCommand /usr/local/libexec/madina-terminal-authorized-key
    AuthorizedKeysCommandUser root
    AuthenticationMethods publickey
    PasswordAuthentication no
    KbdInteractiveAuthentication no
    AllowTcpForwarding remote
    PermitListen 127.0.0.1:3201 127.0.0.1:13306
    PermitOpen none
    GatewayPorts no
    X11Forwarding no
    AllowAgentForwarding no
    PermitTTY no
    MaxSessions 0
Match all
SSH
ssh_backup=$(mktemp)
cp -p /etc/ssh/sshd_config "$ssh_backup"
if ! grep -qxF 'Include /etc/ssh/madina-terminal.conf' /etc/ssh/sshd_config; then
  printf '\n# Restricted Madina terminal tunnel; keep this include last.\nInclude /etc/ssh/madina-terminal.conf\n' >> /etc/ssh/sshd_config
fi
if ! sshd -t; then
  cp -p "$ssh_backup" /etc/ssh/sshd_config
  rm -f "$ssh_backup"
  echo 'SSH validation failed; the original configuration was restored.' >&2
  exit 1
fi
rm -f "$ssh_backup"
systemctl reload ssh
cat > /etc/sudoers.d/madina-terminal <<'SUDO'
madina-express ALL=(root) NOPASSWD: /usr/local/libexec/madina-terminal-control prepare, /usr/local/libexec/madina-terminal-control register, /usr/local/libexec/madina-terminal-control freeze, /usr/local/libexec/madina-terminal-control activate, /usr/local/libexec/madina-terminal-control abort, /usr/local/libexec/madina-terminal-control status
SUDO
chmod 0440 /etc/sudoers.d/madina-terminal
visudo -cf /etc/sudoers.d/madina-terminal
# The Windows service uses only portable JavaScript dependencies. No cloud secrets are included.
staging=$(mktemp -d)
trap 'rm -rf "$staging"' EXIT
cp "$PROJECT_DIR/package.json" "$PROJECT_DIR/package-lock.json" "$staging/"
(cd "$staging" && npm ci --omit=dev --ignore-scripts >/dev/null)
rsync -a --exclude .env --exclude .terminal --exclude __pycache__ --exclude tests "$PROJECT_DIR/backend/" "$staging/backend/"
cp -a "$PROJECT_DIR/dist" "$staging/dist"
mkdir -p "$staging/deploy"
cp -a "$PROJECT_DIR/deploy/windows" "$staging/deploy/windows"
(cd "$staging" && zip -q -r "$STATE_DIR/base.next.zip" .)
chown root:madina-express "$STATE_DIR/base.next.zip"
chmod 0640 "$STATE_DIR/base.next.zip"
mv "$STATE_DIR/base.next.zip" "$STATE_DIR/base.zip"
# A verified, versioned VC runtime avoids a mutable Microsoft download URL changing underneath setup.
install -d -m 0755 /var/www/madina-express/terminal-runtime
runtime_sha=cc0ff0eb1dc3f5188ae6300faef32bf5beeba4bdd6e8e445a9184072096b713b
runtime_file=/var/www/madina-express/terminal-runtime/vc-redist-$runtime_sha.exe
if [[ ! -f $runtime_file ]]; then
  if [[ -f /root/madina-runtime-downloads/vc_redist.x64.exe ]]; then
    cp /root/madina-runtime-downloads/vc_redist.x64.exe "$runtime_file"
  else
    curl -fL https://aka.ms/vs/17/release/vc_redist.x64.exe -o "$runtime_file"
  fi
fi
printf '%s  %s\n' "$runtime_sha" "$runtime_file" | sha256sum -c -
chmod 0644 "$runtime_file"
for setting in TERMINAL_ROLE=cloud TERMINAL_DIRECTORY="$STATE_DIR" ADMIN_TOTP_PAUSED=false; do
  key=${setting%%=*}
  if grep -q "^$key=" "$PROJECT_DIR/backend/.env"; then
    sed -i "s|^$key=.*|$setting|" "$PROJECT_DIR/backend/.env"
  else
    printf '\n%s\n' "$setting" >> "$PROJECT_DIR/backend/.env"
  fi
done
chown root:madina-express "$PROJECT_DIR/backend/.env"
chmod 0640 "$PROJECT_DIR/backend/.env"
echo 'Terminal installer support is prepared. The cloud stays the writer until the main PC begins setup.'
