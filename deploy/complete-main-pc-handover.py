#!/usr/bin/env python3
"""Root-only completion after a signed, fenced and fully replicated test-PC handover."""
import json
import os
import pathlib
import pwd
import re
import shutil
import subprocess
import sys
import time
import urllib.request

ROOT = pathlib.Path('/var/lib/madina-express/terminal')
UPDATES = pathlib.Path('/var/lib/madina-express/updates')
ADMIN = '/etc/madina-express/mysql-admin.cnf'


def validate_claim(command, config, acknowledgement, health):
    if command.get('action') != 'prepare-main-pc-handover' or command.get('installationId') != config.get('installationId'):
        raise ValueError('The signed handover does not name the current test main PC.')
    if acknowledgement.get('nonce') != command['nonce'] or acknowledgement.get('stage') != 'applied' or acknowledgement.get('retired') is not True or acknowledgement.get('devicesPreserved') is not False:
        raise ValueError('The test main PC has not acknowledged cleanup and device revocation.')
    fence = health.get('handover') or {}
    if health.get('installationId') != command['installationId'] or health.get('release', {}).get('releaseId') != command['releaseId'] or fence.get('nonce') != command['nonce'] or fence.get('stage') != 'ready':
        raise ValueError('The live test main PC does not confirm the matching persistent write fence.')


def sql(statement):
    return subprocess.check_output(['mysql', '--defaults-extra-file=' + ADMIN, '-NBr', '-e', statement], text=True).strip()


def source_gtids(config):
    value = subprocess.check_output(['mysql', '--no-defaults', '--connect-timeout=5', '-h127.0.0.1', '-P13306', '-umadina_repl', '-NBr', '-e', 'SELECT @@GLOBAL.gtid_executed'],
                                    env={**os.environ, 'MYSQL_PWD': config['replicationPassword']}, text=True)
    value = re.sub(r'\s+', '', value)
    if not value or not re.fullmatch(r'[a-fA-F0-9:,\-]+', value):
        raise ValueError('The source GTID proof is invalid.')
    return value


def write_state(path, value):
    temporary = path.with_suffix('.next')
    temporary.write_text(json.dumps(value))
    os.chmod(temporary, 0o640)
    os.chown(temporary, 0, pwd.getpwnam('madina-express').pw_gid)
    os.replace(temporary, path)


def main():
    if os.geteuid() != 0 or len(sys.argv) != 3 or sys.argv[1] != '--confirm':
        raise ValueError('Run as root: complete-main-pc-handover.py --confirm SIGNED_NONCE')
    state = json.loads((ROOT / 'state.json').read_text())
    if state.get('phase') != 'active':
        raise ValueError('Only the currently active, fenced test main can be handed over.')
    config = json.loads((ROOT / 'private.json').read_text())
    current = json.loads(pathlib.Path('/var/lib/madina-express/host/current.json').read_text())
    project = pathlib.Path(current['application']).resolve()
    if pathlib.Path(__file__).resolve().parents[1] != project:
        raise ValueError('Use the accepted signed release, not a mutable checkout.')
    envelope = (ROOT / 'owner-maintenance.json').read_text()
    validator = '''import {readFileSync} from 'node:fs';
const {verifyOwnerCommand}=await import(process.argv[1]);
console.log(JSON.stringify(verifyOwnerCommand(JSON.parse(readFileSync(0,'utf8')),readFileSync(process.argv[2]),JSON.parse(process.argv[3]))));'''
    command = json.loads(subprocess.check_output(['/opt/node-current/bin/node', '--input-type=module', '-e', validator,
        (project / 'backend/terminal/owner-command.js').as_uri(), '/etc/madina-express/release-public-key.pem',
        json.dumps({'installationId': config['installationId'], 'releaseId': current['releaseId']})], input=envelope, text=True))
    if sys.argv[2] != command['nonce']:
        raise ValueError('The explicit confirmation does not match the signed handover nonce.')
    acknowledgement = json.loads((UPDATES / 'owner-maintenance-result.json').read_text())
    request = urllib.request.Request('http://127.0.0.1:3201/health', headers={'X-Madina-Relay-Key': config['relayKey']})
    with urllib.request.urlopen(request, timeout=8) as response:
        health = json.load(response)
    validate_claim(command, config, acknowledgement, health)
    source = source_gtids(config)
    for _ in range(45):
        if sql("SELECT GTID_SUBSET('%s',@@GLOBAL.gtid_executed)" % source) == '1':
            time.sleep(1)
            if source_gtids(config) == source:
                break
        time.sleep(1)
    else:
        raise ValueError('The fenced source has not fully and stably replicated. No authority changed.')

    # This guard survives cancellation of subsequent setup and keeps the public
    # website closed while root-only provisioning/migrations use the cloud DB.
    write_state(ROOT / 'require-main.json', {'required': True, 'createdAt': int(time.time())})
    site = pathlib.Path('/etc/nginx/sites-available/madina-express')
    old_site = site.read_bytes()
    template = (project / 'deploy/nginx-production.conf.template').read_text()
    template = template.replace('__PUBLIC_HOST__', 'madinaexpress.duckdns.org').replace('__STAFF_HOST__', 'staff.madinaexpress.duckdns.org')
    site.write_text(template)
    os.chmod(site, 0o600)
    try:
        subprocess.run(['nginx', '-t'], check=True)
    except Exception:
        site.write_bytes(old_site)
        raise
    sql("STOP REPLICA FOR CHANNEL 'madina_terminal'")
    if sql("SELECT GTID_SUBSET('%s',@@GLOBAL.gtid_executed)" % source) != '1':
        site.write_bytes(old_site)
        sql("START REPLICA FOR CHANNEL 'madina_terminal'")
        raise ValueError('Final replication proof failed. The old pairing was retained and stays fenced.')
    archive = pathlib.Path('/var/backups/madina-express/deployment') / ('handover-' + time.strftime('%Y%m%d-%H%M%S'))
    archive.mkdir(mode=0o700, parents=True)
    for name in ('private.json', 'state.json', 'owner-maintenance.json'):
        shutil.copyfile(ROOT / name, archive / name)
        os.chmod(archive / name, 0o600)
    shutil.copyfile(UPDATES / 'owner-maintenance-result.json', archive / 'result.json')
    os.chmod(archive / 'result.json', 0o600)
    (ROOT / 'private.json').unlink()
    subprocess.run(['pkill', '-TERM', '-u', 'madina-terminal'], check=False)
    sql("RESET REPLICA ALL FOR CHANNEL 'madina_terminal'")
    # There is no other writer now. HTTP writes remain blocked by require-main;
    # root provisioning and additive release migrations can use this sole copy.
    sql('SET PERSIST super_read_only=OFF; SET PERSIST read_only=OFF')
    write_state(ROOT / 'state.json', {'phase': 'awaiting-main', 'preparedAt': int(time.time())})
    (ROOT / 'owner-maintenance.json').unlink()
    (UPDATES / 'owner-maintenance-result.json').unlink()
    (UPDATES / 'control/terminal.json').unlink(missing_ok=True)
    for pin in pathlib.Path('/etc/nginx/madina-terminal-devices').glob('terminal-*.conf'):
        if re.fullmatch(r'terminal-\d+\.conf', pin.name):
            shutil.copyfile(pin, archive / pin.name)
            pin.unlink()
    subprocess.run(['nginx', '-t'], check=True)
    subprocess.run(['systemctl', 'reload', 'nginx'], check=True)
    print(json.dumps({'phase': 'awaiting-main', 'sourceFenced': True, 'allSourceTransactionsReplicated': True,
                      'oldPairingRevoked': True, 'newInstallerAvailable': True, 'publicBookingsPaused': True}))


if __name__ == '__main__':
    main()
