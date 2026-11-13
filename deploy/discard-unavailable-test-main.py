#!/usr/bin/env python3
"""Explicit root recovery after the owner discards an unavailable TEST main PC.

Not failover: unsynced transactions are intentionally abandoned. Normal handovers
must use complete-main-pc-handover.py and verify final source replication.
"""
import fcntl
import gzip
import json
import os
import pathlib
import pwd
import shutil
import socket
import subprocess
import sys
import tempfile
import time

ROOT = pathlib.Path('/var/lib/madina-express/terminal')
ADMIN = pathlib.Path('/etc/madina-express/mysql-admin.cnf')
CONFIRMATION = 'DISCARD-OLD-TEST-PC-AND-UNSYNCED-DATA'


def validate_request(arguments, phase, source_reachable):
    if arguments != ['--confirm', CONFIRMATION]:
        raise ValueError('Explicit authorization to discard the old test PC and unsynced data is required.')
    if phase not in ('active', 'awaiting-main'):
        raise ValueError('Finish or cancel the current setup before this recovery.')
    if source_reachable:
        raise ValueError('The old main PC is reachable. Use the synchronized handover instead.')


def sql(statement):
    return subprocess.check_output(['mysql', '--defaults-extra-file=' + str(ADMIN), '-NBr', '-e', statement], text=True).strip()


def write_state(name, value):
    path = ROOT / name
    temporary = path.with_suffix('.next')
    temporary.write_text(json.dumps(value))
    os.chmod(temporary, 0o640)
    os.chown(temporary, 0, pwd.getpwnam('madina-express').pw_gid)
    os.replace(temporary, path)


def main():
    if os.geteuid() != 0:
        raise ValueError('Run this recovery as root.')
    try:
        with socket.create_connection(('127.0.0.1', 3201), timeout=3):
            reachable = True
    except OSError:
        reachable = False
    state = json.loads((ROOT / 'state.json').read_text())
    validate_request(sys.argv[1:], state.get('phase'), reachable)
    archive = pathlib.Path('/var/backups/madina-express/deployment') / ('discarded-test-main-' + time.strftime('%Y%m%d-%H%M%S'))
    archive.mkdir(mode=0o700, parents=True)
    with tempfile.NamedTemporaryFile(mode='w', prefix='mysql-', dir=archive) as options:
        os.chmod(options.name, 0o600)
        options.write('\n'.join(line for line in ADMIN.read_text().splitlines() if not line.strip().startswith('database=')))
        options.flush()
        with gzip.open(archive / 'before-reset.sql.gz', 'wb') as output:
            process = subprocess.Popen(['mysqldump', '--defaults-extra-file=' + options.name, '--single-transaction', '--set-gtid-purged=OFF', '--no-tablespaces', 'madina_express'], stdout=subprocess.PIPE)
            shutil.copyfileobj(process.stdout, output)
            if process.wait() != 0:
                raise ValueError('Backup failed; no pairing was changed.')
    os.chmod(archive / 'before-reset.sql.gz', 0o600)
    with (ROOT / '.lock').open('w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        subprocess.run(['systemctl', 'stop', 'madina-release-update.timer', 'madina-release-update.service', 'madina-express'], check=True)
        site = pathlib.Path('/etc/nginx/sites-available/madina-express')
        shutil.copyfile(site, archive / 'nginx.conf')
        os.chmod(archive / 'nginx.conf', 0o600)
        # External APIs stay closed until the signed release and fresh DB are ready.
        previous = site.read_text()
        text = previous.replace('    location /api/ {', '    location ^~ /api/ { return 503;')
        if text == previous:
            raise ValueError('Expected API locations are missing. No pairing was changed.')
        site.write_text(text)
        try:
            subprocess.run(['nginx', '-t'], check=True)
            subprocess.run(['systemctl', 'reload', 'nginx'], check=True)
        except Exception:
            site.write_text(previous)
            raise
        write_state('require-main.json', {'required': True, 'createdAt': int(time.time())})
        for name in ('private.json', 'state.json', 'owner-maintenance.json', 'snapshot.sql'):
            path = ROOT / name
            if path.exists():
                shutil.copyfile(path, archive / name)
                os.chmod(archive / name, 0o600)
        (ROOT / 'private.json').unlink(missing_ok=True)
        subprocess.run(['pkill', '-TERM', '-u', 'madina-terminal'], check=False)
        if sql("SELECT COUNT(*) FROM performance_schema.replication_connection_configuration WHERE CHANNEL_NAME='madina_terminal'") != '0':
            sql("STOP REPLICA FOR CHANNEL 'madina_terminal'; RESET REPLICA ALL FOR CHANNEL 'madina_terminal'")
        sql('SET PERSIST super_read_only=OFF; SET PERSIST read_only=OFF')
        write_state('state.json', {'phase': 'awaiting-main', 'preparedAt': int(time.time()), 'oldTestDataDiscarded': True})
        for name in ('owner-maintenance.json', 'snapshot.sql'):
            (ROOT / name).unlink(missing_ok=True)
        for pin in pathlib.Path('/etc/nginx/madina-terminal-devices').glob('terminal-*.conf'):
            shutil.copyfile(pin, archive / pin.name)
            pin.unlink()
        for name in ('control/terminal.json', 'owner-maintenance-result.json'):
            pathlib.Path('/var/lib/madina-express/updates', name).unlink(missing_ok=True)
    print(json.dumps({'phase': 'awaiting-main', 'oldPairingRevoked': True, 'unsyncedDataDiscarded': True,
                      'nextStep': 'Install the verified release, clear operational data and restore its production nginx template.'}))


if __name__ == '__main__':
    main()
