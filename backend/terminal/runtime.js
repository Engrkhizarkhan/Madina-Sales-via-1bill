import { maintenance } from "../update/maintenance.js";
import { releaseInfo } from "../update/version.js";
import { applyOwnerCommand } from "./owner-command.js";
import { spawn } from "node:child_process";
import { readFile, writeFile, rename, readdir, unlink, mkdir } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { createGzip } from "node:zlib";
import { pipeline } from "node:stream/promises";
import { join,resolve } from "node:path";
import { config } from "../node/config.js";
import { pool } from "../node/db.js";

let maintenanceResult;
let stopped = false;
let tunnel;
let statusTimer;
let backupTimer;
let reconnectTimer;

export async function terminalPaired() {
  if (!config.terminal.local) return true;
  try {
    const ready = JSON.parse(await readFile(join(config.terminal.directory, "ready.json"), "utf8"));
    return ready.installationId === process.env.TERMINAL_INSTALLATION_ID;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

export async function terminalHandover() {
  if (!config.terminal.local) return null;
  try {return JSON.parse(await readFile(join(config.terminal.directory,'handover.json'),'utf8'));}
  catch(error){if(error.code==='ENOENT')return null;throw error;}
}
export async function terminalReady() {
  return await terminalPaired() && !(await terminalHandover());
}

async function publishConnection(status) {
  const temporary = join(config.terminal.directory, "connection.next");
  await writeFile(temporary, JSON.stringify({ ...status, checkedAt: new Date().toISOString() }), { mode: 0o600 });
  await rename(temporary, join(config.terminal.directory, "connection.json"));
}

async function callCloud(action) {
  const response = await fetch(config.terminal.cloudOrigin + "/api/terminal-sync/" + action, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Terminal-Token": process.env.TERMINAL_INSTALL_TOKEN },
    body: JSON.stringify({ installationId: process.env.TERMINAL_INSTALLATION_ID,maintenanceResult }),
    signal: AbortSignal.timeout(action === "activate" ? 90000 : 15000),
  });
  if (!response.ok) throw new Error(`The cloud ${action} check returned ${response.status}.`);
  return response.json();
}

async function refreshStatus() {
  try {
    const ready = await terminalPaired();
    const handingOver = await terminalHandover();
    const checkStarted = performance.now();
    const status = await callCloud(ready ? "status" : "activate");
    const cloudLatencyMs = Math.round(performance.now() - checkStarted);
    if (!handingOver && Array.isArray(status.revokedSessions)) {
      const hashes = status.revokedSessions.filter(hash => typeof hash === "string" && /^[a-f0-9]{64}$/.test(hash));
      for (let index = 0; index < hashes.length; index += 100) {
        const batch = hashes.slice(index, index + 100);
        await pool.execute(`DELETE FROM api_sessions WHERE token_hash IN (${batch.map(() => "?").join(",")})`, batch);
      }
    }
    if(!handingOver && Array.isArray(status.mfaSteps))for(const value of status.mfaSteps){
      if(Number.isSafeInteger(value.userId)&&Number.isSafeInteger(value.step))await pool.execute('UPDATE users SET mfa_last_step=GREATEST(mfa_last_step,?) WHERE id=?',[value.step,value.userId]);
    }
    if (!ready && status.active) {
      await writeFile(join(config.terminal.directory, "ready.json"),
        JSON.stringify({ installationId: process.env.TERMINAL_INSTALLATION_ID }), { mode: 0o600 });
    }
    if (ready && status.maintenanceCommand && status.ioRunning && status.sqlRunning) {
      try {
        const key=await readFile(resolve('deploy/updater/release-public-key.pem'));
        const {clearOperationalData}=await import('../node/production-reset.js');
        maintenanceResult=await applyOwnerCommand(status.maintenanceCommand,{
          key,installationId:process.env.TERMINAL_INSTALLATION_ID,releaseId:releaseInfo.releaseId,
          begin:()=>maintenance.beginOwnerMaintenance(0),end:()=>maintenance.endOwnerMaintenance(),
          loadOwner:async id=>(await pool.execute('SELECT id,role,is_owner,active FROM users WHERE id=?',[id]))[0][0],
          execute:async(owner,command)=>{
            if(command.action!=='prepare-main-pc-handover')return clearOperationalData(owner,{ip:'signed-operator-command'},command);
            const handover={installationId:process.env.TERMINAL_INSTALLATION_ID,nonce:command.nonce,stage:'preparing'};
            const path=join(config.terminal.directory,'handover.json');
            await writeFile(path,JSON.stringify(handover),{mode:0o600});
            const result=await clearOperationalData(owner,{ip:'signed-operator-handover'},command);
            await writeFile(path,JSON.stringify({...handover,stage:'ready'}),{mode:0o600});
            return {...result,retired:true};
          },
        });
      } catch(error) { console.error('Signed maintenance:',error.message); }
    }
    await publishConnection({
      connected: (status.phase === "active" || status.active === true) && status.tunnelHealthy !== false,
      replicated: status.ioRunning === true && status.sqlRunning === true,
      secondsBehind: status.secondsBehind ?? null,
      replicationError: status.error === true,
      cloudLatencyMs,
    });
  } catch (error) {
    await publishConnection({ connected: false, replicated: false, message: error.message }).catch(() => undefined);
  } finally {
    if (!stopped) statusTimer = setTimeout(refreshStatus, 10000).unref();
  }
}

function startTunnel() {
  if (stopped) return;
  tunnel = spawn(process.env.TERMINAL_SSH_PATH || "ssh", [
    "-N", "-T", "-i", join(config.terminal.directory, "tunnel-key"),
    "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=yes",
    "-o", `UserKnownHostsFile=${join(config.terminal.directory, "known_hosts")}`,
    "-o", "ExitOnForwardFailure=yes", "-o", "ServerAliveInterval=15", "-o", "ServerAliveCountMax=3",
    "-R", "127.0.0.1:3201:127.0.0.1:" + config.port,
    "-R", "127.0.0.1:13306:127.0.0.1:" + config.db.port,
    "madina-terminal@62.171.173.11",
  ], { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
  tunnel.stderr.on("data", data => console.error("Terminal tunnel:", data.toString().trim()));
  tunnel.on("error", error => console.error("Terminal tunnel could not start:", error.message));
  tunnel.on("close", () => {
    if (!stopped) reconnectTimer = setTimeout(startTunnel, 3000).unref();
  });
}

let backingUp = false;
let lastBackup = 0;
async function backupLocalDatabase() {
  if (backingUp || Date.now() - lastBackup < 20 * 3600000 || !(await terminalReady())) return;
  backingUp = true;
  const directory = join(config.terminal.directory, "backups");
  const name = `madina-${new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z")}.sql.gz`;
  const temporary = join(directory, name + ".part");
  try {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const child = spawn(process.env.TERMINAL_MYSQLDUMP, [
      `--defaults-extra-file=${join(config.terminal.directory, "backup.cnf")}`,
      "--single-transaction", "--set-gtid-purged=OFF", "--no-tablespaces", "--skip-triggers", config.db.database,
    ], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    child.stderr.resume();
    const exit = new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("close", code => code === 0 ? resolve() : reject(new Error("Local database backup failed.")));
    });
    await Promise.all([pipeline(child.stdout, createGzip(), createWriteStream(temporary, { mode: 0o600 })), exit]);
    await rename(temporary, join(directory, name));
    lastBackup = Date.now();
    for (const file of await readdir(directory)) {
      const match = file.match(/^madina-(\d{4})(\d{2})(\d{2})T\d{6}Z.sql.gz$/);
      const resetStamp = file.match(/^production-reset-(\d+)(?:-[a-f0-9]+)?\.json\.gz$/);
      if (resetStamp && Number(resetStamp[1]) < Date.now() - 30 * 86400000) await unlink(join(directory,file));
      if (match && Date.parse(`${match[1]}-${match[2]}-${match[3]}T00:00:00Z`) < Date.now() - 30 * 86400000) {
        await unlink(join(directory, file));
      }
    }
  } catch (error) {
    console.error("Local backup:", error.message);
    await unlink(temporary).catch(() => undefined);
  } finally { backingUp = false; }
}

export function startTerminalRuntime() {
  if (!config.terminal.local) return;
  startTunnel();
  void refreshStatus();
  void backupLocalDatabase();
  backupTimer = setInterval(backupLocalDatabase, 3600000).unref();
}

export function stopTerminalRuntime() {
  stopped = true;
  clearTimeout(statusTimer);
  clearTimeout(reconnectTimer);
  clearInterval(backupTimer);
  tunnel?.kill();
}
