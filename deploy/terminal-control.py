#!/usr/bin/python3
"""Restricted root operations for the single terminal source and cloud replica."""
import fcntl
import json
import os
import pathlib
import pwd
import re
import secrets
import subprocess
import sys
import time
import urllib.request

ROOT = pathlib.Path("/var/lib/madina-express/terminal")
PROJECT = pathlib.Path("/opt/madina-express")
CONFIG = ROOT / "private.json"
STATE = ROOT / "state.json"
SERVICE_GID = pwd.getpwnam("madina-express").pw_gid

def run(args, *, stdin=None):
    result = subprocess.run(args, input=stdin, text=True, capture_output=True, timeout=120)
    if result.returncode:
        raise RuntimeError("A terminal service command failed. Check the server service logs.")
    return result.stdout.strip()

def sql(statement):
    return run(["mysql", "--batch", "--skip-column-names", "-e", statement])

def write_json(path, value):
    temporary = path.with_suffix(".next")
    temporary.write_text(json.dumps(value))
    os.chmod(temporary, 0o640)
    os.chown(temporary, 0, SERVICE_GID)
    os.replace(temporary, path)

def read_json(path, fallback):
    return json.loads(path.read_text()) if path.exists() else fallback

def require_claim(payload, config):
    if payload.get("installationId") != config.get("installationId"):
        raise ValueError("This installer is not registered as the terminal server.")

def prepare():
    state = read_json(STATE, {"phase": "standalone"})
    if state["phase"] in ("preparing", "active"):
        raise ValueError("A terminal server installation is already in progress.")
    config = read_json(CONFIG, {})
    if not config:
        config = {
            "installToken": secrets.token_hex(32),
            "relayKey": secrets.token_hex(32),
            # MySQL SOURCE_PASSWORD accepts at most 32 characters (128 random bits).
            "replicationPassword": secrets.token_hex(16),
            "createdAt": int(time.time()),
        }
        write_json(CONFIG, config)
    write_json(STATE, {"phase": "provisioned"})
    hostkey = pathlib.Path("/etc/ssh/ssh_host_ed25519_key.pub").read_text().split()
    return {**config, "knownHost": "62.171.173.11 " + " ".join(hostkey[:2])}

def register(payload, config):
    state = read_json(STATE, {})
    installation_id = payload.get("installationId", "")
    key = " ".join(str(payload.get("publicKey", "")).split()[:2])
    if not re.fullmatch(r"[0-9a-f-]{36}", installation_id):
        raise ValueError("Invalid installation identifier.")
    if not re.fullmatch(r"ssh-ed25519 [A-Za-z0-9+/=]{50,100}", key):
        raise ValueError("An Ed25519 public key is required.")
    if config.get("installationId") and (
            config["installationId"] != installation_id or config["publicKey"] != key):
        raise ValueError("A different main PC is already registered.")
    if state.get("phase") not in ("provisioned", "preparing", "active"):
        raise ValueError("Download a new installer package first.")
    config.update(installationId=installation_id, publicKey=key)
    write_json(CONFIG, config)
    return {"registered": True}

def freeze(payload, config):
    require_claim(payload, config)
    state = read_json(STATE, {})
    if state.get("phase") == "active":
        raise ValueError("The terminal server is already active. Restore its local backup instead.")
    if state.get("phase") not in ("provisioned", "preparing"):
        raise ValueError("This installer is not ready.")
    write_json(STATE, {"phase": "preparing", "startedAt": int(time.time())})
    # This waits for existing writes, then prevents another cloud writer during transfer.
    sql("SET GLOBAL super_read_only=ON")
    snapshot = ROOT / "snapshot.sql"
    if not snapshot.exists():
        temporary = ROOT / "snapshot.next.sql"
        with temporary.open("w") as destination:
            subprocess.run([
                "mysqldump", "--single-transaction", "--set-gtid-purged=OFF", "--no-tablespaces",
                "--hex-blob", "--routines", "--triggers",
                "madina_express"], stdout=destination, check=True, timeout=120)
        os.chmod(temporary, 0o640)
        os.chown(temporary, 0, SERVICE_GID)
        os.replace(temporary, snapshot)
    return {"snapshot": str(snapshot), "relayKey": config["relayKey"],
            "replicationPassword": config["replicationPassword"]}

def replica_status():
    raw = run(["mysql", "--batch", "-e", "SHOW REPLICA STATUS"])
    lines = raw.splitlines()
    if len(lines) < 2:
        return {"configured": False}
    records = [dict(zip(lines[0].split("\t"), row.split("\t"))) for row in lines[1:]]
    record = next((row for row in records if row.get("Channel_Name") == "madina_terminal"), None)
    if record is None:
        return {"configured": False}
    return {"configured": True, "ioRunning": record.get("Replica_IO_Running") == "Yes",
            "sqlRunning": record.get("Replica_SQL_Running") == "Yes",
            "secondsBehind": int(record["Seconds_Behind_Source"]) if record.get("Seconds_Behind_Source", "NULL").isdigit() else None,
            "error": bool(record.get("Last_IO_Error") or record.get("Last_SQL_Error"))}

def configure_replication(config):
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,32}", config.get("replicationPassword", "")):
        raise ValueError("The database sync credential needs repair before activation. Contact the administrator; the imported database is retained.")
    sql("SET PERSIST server_id=200")
    sql("SET PERSIST enforce_gtid_consistency=ON")
    current_mode = sql("SELECT @@global.gtid_mode")
    for mode in ("OFF_PERMISSIVE", "ON_PERMISSIVE", "ON"):
        if current_mode == "ON":
            break
        modes = ["OFF", "OFF_PERMISSIVE", "ON_PERMISSIVE", "ON"]
        if modes.index(mode) > modes.index(current_mode):
            sql("SET PERSIST gtid_mode=" + mode)
            current_mode = mode
    sql("SET PERSIST super_read_only=ON")
    if replica_status().get("configured"):
        sql("STOP REPLICA FOR CHANNEL 'madina_terminal'")
    sql("CHANGE REPLICATION SOURCE TO SOURCE_HOST='127.0.0.1', SOURCE_PORT=13306, "
        "SOURCE_USER='madina_repl', SOURCE_PASSWORD='" + config["replicationPassword"] + "', "
        "SOURCE_AUTO_POSITION=1, GET_SOURCE_PUBLIC_KEY=1, SOURCE_CONNECT_RETRY=3 "
        "FOR CHANNEL 'madina_terminal'")
    sql("CHANGE REPLICATION FILTER REPLICATE_WILD_DO_TABLE = ('madina_express.%') FOR CHANNEL 'madina_terminal'")
    sql("START REPLICA FOR CHANNEL 'madina_terminal'")
    for _ in range(20):
        status = replica_status()
        if status.get("ioRunning") and status.get("sqlRunning"):
            break
        time.sleep(1)
    if not status.get("sqlRunning") or not status.get("ioRunning"):
        raise ValueError("Replication could not start. Check the main PC tunnel and try activation again.")
    return status

def activate(payload, config):
    require_claim(payload, config)
    state = read_json(STATE, {})
    if state.get("phase") == "active":
        return {"active": True, **replica_status()}
    if state.get("phase") != "preparing":
        raise ValueError("The initial data transfer has not started.")
    request = urllib.request.Request("http://127.0.0.1:3201/health",
                                     headers={"X-Madina-Relay-Key": config["relayKey"]})
    with urllib.request.urlopen(request, timeout=6) as response:
        source = json.load(response)
    if source.get("installationId") != config["installationId"]:
        raise ValueError("The main PC tunnel does not match this installation.")
    status = configure_replication(config)
    template = (ROOT / "nginx-terminal.conf.template").read_text()
    site = pathlib.Path("/etc/nginx/sites-available/madina-express")
    old = site.read_text()
    site.write_text(template.replace("__RELAY_KEY__", config["relayKey"]))
    os.chmod(site, 0o600)
    try:
        run(["nginx", "-t"])
        run(["systemctl", "reload", "nginx"])
    except Exception:
        site.write_text(old)
        run(["mysql", "-e", "STOP REPLICA FOR CHANNEL 'madina_terminal'"])
        raise
    write_json(STATE, {"phase": "active", "activatedAt": int(time.time()),
                      "installationId": config["installationId"]})
    # The source is now the only writer. Reusing this stale seed must require explicit recovery.
    (ROOT / "snapshot.sql").unlink(missing_ok=True)
    return {"active": True, **status}

def abort(payload, config):
    require_claim(payload, config)
    state = read_json(STATE, {})
    if state.get("phase") != "preparing":
        raise ValueError("An active terminal source cannot be replaced automatically.")
    if replica_status().get("configured"):
        sql("STOP REPLICA FOR CHANNEL 'madina_terminal'")
    sql("SET PERSIST super_read_only=OFF")
    sql("SET PERSIST read_only=OFF")
    (ROOT / "snapshot.sql").unlink(missing_ok=True)
    write_json(STATE, {"phase": "provisioned"})
    return {"cancelled": True}

def main():
    if os.geteuid() != 0 or len(sys.argv) != 2:
        raise ValueError("This command requires the root terminal control service.")
    ROOT.mkdir(parents=True, exist_ok=True)
    os.chmod(ROOT, 0o750)
    os.chown(ROOT, 0, SERVICE_GID)
    payload = json.loads(sys.stdin.read(16384) or "{}")
    with (ROOT / ".lock").open("w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        action = sys.argv[1]
        if action == "reset":
            state = read_json(STATE, {})
            if state.get("phase") == "active":
                raise ValueError("An active main PC requires a verified data recovery, not a setup reset.")
            if replica_status().get("configured"):
                sql("STOP REPLICA FOR CHANNEL 'madina_terminal'")
            sql("SET PERSIST super_read_only=OFF")
            sql("SET PERSIST read_only=OFF")
            CONFIG.unlink(missing_ok=True)
            (ROOT / "snapshot.sql").unlink(missing_ok=True)
            subprocess.run(["pkill", "-u", "madina-terminal"], check=False)
            write_json(STATE, {"phase": "standalone"})
            result = {"cancelled": True}
        elif action == "prepare":
            result = prepare()
        else:
            config = read_json(CONFIG, {})
            if action == "register": result = register(payload, config)
            elif action == "freeze": result = freeze(payload, config)
            elif action == "activate": result = activate(payload, config)
            elif action == "abort": result = abort(payload, config)
            elif action == "status": result = {**read_json(STATE, {"phase": "standalone"}), **replica_status()}
            else: raise ValueError("Unknown terminal operation.")
        print(json.dumps(result))

if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print("Terminal setup failed: " + str(error), file=sys.stderr)
        sys.exit(1)
