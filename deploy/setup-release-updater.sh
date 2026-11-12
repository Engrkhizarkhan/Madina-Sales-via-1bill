#!/usr/bin/env bash
set -euo pipefail
umask 022
[[ $EUID -eq 0 ]] || { echo 'Run as root.' >&2; exit 1; }
PROJECT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
install -d -m 0755 /etc/madina-express /var/lib/madina-express/host /var/lib/madina-express/releases /var/lib/madina-express/updates /usr/local/libexec/madina-updater
install -d -m 0700 -o madina-express -g madina-express /var/lib/madina-express/updates/control
install -d -m 0700 /var/cache/madina-express/runtime /var/cache/madina-express/npm
printf '%s\n' '# Public dependencies only; no user credentials required.' > /etc/madina-express/npmrc
if [[ ! -f /etc/madina-express/backend.env ]]; then
  install -m 0640 -o root -g madina-express "$PROJECT_DIR/backend/.env" /etc/madina-express/backend.env
fi
python3 - "$PROJECT_DIR" <<'PY'
from pathlib import Path
import sys,json,secrets,os
project=Path(sys.argv[1]);env=Path('/etc/madina-express/backend.env');text=env.read_text()
if '\nUPDATE_CONTROL_KEY=' not in '\n'+text:text+='\nUPDATE_CONTROL_KEY='+secrets.token_hex(32)+'\n'
if '\nUPDATE_JOURNAL_PATH=' not in '\n'+text:text+='\nUPDATE_JOURNAL_PATH=/var/lib/madina-express/host/transaction.json\n'
if '\nCLOUD_UPDATE_DIRECTORY=' not in '\n'+text:text+='\nCLOUD_UPDATE_DIRECTORY=/var/lib/madina-express/updates\n'
env.write_text(text);os.chmod(env,0o640)
link=project/'backend/.env'
if not link.is_symlink():link.unlink();link.symlink_to(env)
host=Path('/var/lib/madina-express/host');pointer=host/'current.json'
if not pointer.exists():
 info=json.loads((project/'build-info.json').read_text());pointer.write_text(json.dumps({'application':str(project),'releaseId':info['releaseId'],'version':info['version'],'sequence':info['sequence']}));os.chmod(pointer,0o644)
current=Path('/var/lib/madina-express/current')
if not current.exists():current.symlink_to(json.loads(pointer.read_text())['application'])
PY
chown root:madina-express /etc/madina-express/backend.env
install -m 0644 "$PROJECT_DIR/deploy/updater/release-public-key.pem" /etc/madina-express/release-public-key.pem
install -m 0644 "$PROJECT_DIR/deploy/updater/release.mjs" "$PROJECT_DIR/deploy/updater/engine.mjs" "$PROJECT_DIR/deploy/updater/cloud-mirror.mjs" "$PROJECT_DIR/deploy/updater/application-path.mjs" "$PROJECT_DIR/deploy/updater/run-api.mjs" /usr/local/libexec/madina-updater/
cat > /etc/madina-express/mysql-admin.cnf <<'CNF'
[client]
socket=/var/run/mysqld/mysqld.sock
user=root
database=madina_express
CNF
chmod 0600 /etc/madina-express/mysql-admin.cnf
# A stable supervisor reads the protected application pointer on every restart.
install -m 0644 "$PROJECT_DIR/deploy/ecosystem.config.cjs" /etc/madina-express/ecosystem.config.cjs
python3 - <<'PY'
from pathlib import Path
unit=Path('/etc/systemd/system/madina-express.service');text=unit.read_text()
text=text.replace('WorkingDirectory=/opt/madina-express','WorkingDirectory=/var/lib/madina-express/current')
text=text.replace('/opt/madina-express/deploy/ecosystem.config.cjs','/etc/madina-express/ecosystem.config.cjs')
unit.write_text(text)
common=Path('/etc/nginx/snippets/madina-common.conf');text=common.read_text()
if 'location ^~ /updates/' not in text:
 text+='\n# Signed packages are separate from public website deployment files.\nlocation ^~ /updates/ { alias /var/lib/madina-express/updates/; autoindex off; limit_except GET { deny all; } }\nlocation = /index.html { expires -1; }\n'
if 'location ^~ /updates/control/' not in text:text+='\nlocation ^~ /updates/control/ { return 404; }\n'
common.write_text(text)
PY
install -m 0644 "$PROJECT_DIR/deploy/madina-release-update.service" /etc/systemd/system/madina-release-update.service
install -m 0644 "$PROJECT_DIR/deploy/madina-release-update.timer" /etc/systemd/system/madina-release-update.timer
chown root:madina-express /var/lib/madina-express
chmod 0751 /var/lib/madina-express
systemctl daemon-reload
nginx -t
systemctl reload nginx
if [[ ${MADINA_ENABLE_RELEASE_UPDATES:-true} == true ]]; then
 systemctl enable --now madina-release-update.timer
else
 systemctl enable madina-release-update.timer
fi
echo 'Release mirror and isolated application paths configured.'
