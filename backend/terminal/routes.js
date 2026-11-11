import { Router } from "express";
import bcrypt from "bcryptjs";
import { randomBytes, timingSafeEqual, createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile, copyFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { zipSync } from "fflate";
import { config } from "../node/config.js";
import { pool, transaction } from "../node/db.js";
import { fail, tokenHash, sqlDateTime } from "../node/helpers.js";
import { audit } from "../node/operations.js";
import { limitAttempts } from "../node/access.js";
import { terminalControl, runProcess } from "./process.js";
import { terminalState } from "./state.js";
import { signTerminalRequest } from "./certificates.js";
import { CloudSessions } from "../node/cloud-sessions.js";

const route = handler => (req, res, next) => Promise.resolve(handler(req, res)).catch(next);
const bytes = value => new Uint8Array(Buffer.from(value));
const requireAdmin = req => {
  if (req.user?.role !== "admin") fail("Administrator access is required.", 403, "forbidden");
};
async function confirmPassword(req) {
  requireAdmin(req);
  limitAttempts("terminal-setup", req, 12, 15 * 60000);
  const password = req.body?.currentPassword;
  if (typeof password !== "string" || Buffer.byteLength(password) > 72) fail("Enter your administrator password.", 422, "invalid_password");
  const [[user]] = await pool.execute("SELECT password_hash FROM users WHERE id = ? AND active = 1", [req.user.id]);
  if (!user || !(await bcrypt.compare(password, user.password_hash))) fail("The administrator password is incorrect.", 422, "invalid_password");
}
async function authenticateInstaller(req) {
  if (!config.terminal.cloud) fail("Terminal setup is unavailable here.", 404, "not_found");
  const supplied = req.get("X-Terminal-Token") || "";
  let privateData;
  try { privateData = JSON.parse(await readFile(join(config.terminal.directory, "private.json"), "utf8")); }
  catch (error) { if (error.code === "ENOENT") fail("Download a terminal setup file first.", 401, "installer_unauthorized"); else throw error; }
  if (supplied.length !== 64 || !timingSafeEqual(Buffer.from(tokenHash(supplied)), Buffer.from(tokenHash(privateData.installToken)))) {
    fail("The terminal installer is not authorized.", 401, "installer_unauthorized");
  }
}

export const terminalSyncRouter = Router();
terminalSyncRouter.get("/public-status", route(async (_req, res) => {
  const state = await terminalState();
  res.json({ phase: state.phase });
}));
for (const action of ["register", "activate", "abort"]) {
  terminalSyncRouter.post("/" + action, route(async (req, res) => {
    await authenticateInstaller(req);
    const result = await terminalControl(action, req.body);
    res.json(result);
  }));
}
terminalSyncRouter.post("/status", route(async (req, res) => {
  await authenticateInstaller(req);
  const state = await terminalControl("status");
  const sessions = new CloudSessions(process.env.CLOUD_SESSION_DIRECTORY || resolve("backend", ".cloud-sessions"));
  res.json({ ...state, revokedSessions: await sessions.revokedHashes() });
}));
terminalSyncRouter.post("/bootstrap", route(async (req, res) => {
  await authenticateInstaller(req);
  const state = await terminalControl("freeze", req.body);
  const temporary = await mkdtemp(join(tmpdir(), "madina-bootstrap-"));
  try {
    await copyFile(state.snapshot, join(temporary, "database.sql"));
    await writeFile(join(temporary, "settings.json"), JSON.stringify({
      relayKey: state.relayKey, replicationPassword: state.replicationPassword,
      adminOtpHex: config.adminOtpKey?.toString("hex") || "",
    }), { mode: 0o600 });
    await runProcess("zip", ["-0", "-q", join(temporary, "bootstrap.zip"), "database.sql", "settings.json"], { cwd: temporary });
    res.set("X-Accel-Buffering", "no");
    res.download(join(temporary, "bootstrap.zip"), "bootstrap.zip", () => void rm(temporary, { recursive: true, force: true }));
  } catch (error) {
    await rm(temporary, { recursive: true, force: true });
    throw error;
  }
}));

export const terminalEnrollmentRouter = Router();
terminalEnrollmentRouter.post("/enroll", route(async (req, res) => {
  if (!config.terminal.local) fail("Open the main PC’s local address to enroll a PC.", 404, "not_found");
  limitAttempts("device-enrollment", req, 20, 15 * 60000);
  const { token, request, slot } = req.body || {};
  if (![1, 2, 3].includes(slot) || typeof token !== "string" || !/^[0-9a-f]{64}$/.test(token)) {
    fail("Use the setup file provided by your administrator.", 422, "invalid_enrollment");
  }
  const certificate = await transaction(async connection => {
    const [[enrollment]] = await connection.execute(
      "SELECT slot FROM terminal_enrollments WHERE slot = ? AND token_hash = ? AND expires_at > NOW() FOR UPDATE",
      [slot, tokenHash(token)],
    );
    if (!enrollment) fail("This setup file has expired or was already used. Generate another in Settings.", 409, "enrollment_expired");
    const signed = await signTerminalRequest(request, slot);
    await connection.execute(
      `INSERT INTO terminal_devices (slot, fingerprint, certificate, expires_at) VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE fingerprint = ?, certificate = ?, expires_at = ?, enrolled_at = NOW()`,
      [slot, signed.fingerprint, signed.pem, sqlDateTime(signed.expiresAt), signed.fingerprint, signed.pem, sqlDateTime(signed.expiresAt)],
    );
    await connection.execute("DELETE FROM terminal_enrollments WHERE slot = ?", [slot]);
    await audit("terminal.enrolled", "terminal_device", slot, null, { fingerprint: signed.fingerprint }, null, req, connection);
    return signed.pem;
  });
  res.json({ certificate });
}));

export const terminalAdminRouter = Router();
terminalAdminRouter.post("/cancel-setup", route(async (req, res) => {
  await confirmPassword(req);
  if (!config.terminal.cloud) fail("Cancel setup from the cloud staff website.", 409, "cloud_required");
  const state = await terminalControl("reset");
  res.json(state);
}));
terminalAdminRouter.get("/connection", route(async (_req, res) => {
  if (!config.terminal.local) return res.json({ local: false, connected: !_req.cloudReadOnly, replicated: !_req.cloudReadOnly, readOnly: Boolean(_req.cloudReadOnly) });
  let status = {};
  try { status = JSON.parse(await readFile(join(config.terminal.directory, "connection.json"), "utf8")); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  const fresh = Date.now() - Date.parse(status.checkedAt || "") < 90000;
  res.json({ local: true, connected: fresh && status.connected === true, replicated: fresh && status.replicated === true });
}));
terminalAdminRouter.get("/status", route(async (req, res) => {
  requireAdmin(req);
  if (config.terminal.local) {
    let status = { connected: false };
    try { status = JSON.parse(await readFile(join(config.terminal.directory, "connection.json"), "utf8")); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
    res.json({ mode: "terminal", localOrigin: config.terminal.localOrigin, ...status });
  } else {
    const state = await terminalState();
    res.json({ mode: config.terminal.cloud ? "cloud" : "standalone", phase: state.phase });
  }
}));
terminalAdminRouter.post("/package", route(async (req, res) => {
  await confirmPassword(req);
  if (!config.terminal.cloud) fail("Download the main PC installer from the production staff website.", 409, "cloud_required");
  const setup = await terminalControl("prepare");
  const temporary = await mkdtemp(join(tmpdir(), "madina-installer-"));
  try {
    await copyFile(join(config.terminal.directory, "base.zip"), join(temporary, "application.zip"));
    await copyFile(resolve("deploy/windows/Install-Main-PC.ps1"), join(temporary, "Install-Main-PC.ps1"));
    await copyFile(resolve("deploy/windows/Install-Main-PC.cmd"), join(temporary, "Install-Main-PC.cmd"));
    await copyFile(resolve("deploy/windows/runtime.json"), join(temporary, "runtime.json"));
    for (const file of ["Change-Main-PC-Network.cmd", "Change-Main-PC-Network.ps1", "Change-Terminal-PC-Address.cmd", "Change-Terminal-PC-Address.ps1"]) {
      await copyFile(resolve("deploy/windows", file), join(temporary, file));
    }
    await writeFile(join(temporary, "setup.json"), JSON.stringify({
      token: setup.installToken, knownHost: setup.knownHost, cloudOrigin: "https://staff.madinaexpress.duckdns.org",
    }), { mode: 0o600 });
    await runProcess("zip", ["-0", "-q", join(temporary, "main-pc.zip"), "application.zip", "Install-Main-PC.ps1",
      "Install-Main-PC.cmd", "runtime.json", "setup.json", "Change-Main-PC-Network.cmd", "Change-Main-PC-Network.ps1", "Change-Terminal-PC-Address.cmd", "Change-Terminal-PC-Address.ps1"], { cwd: temporary });
    await audit("terminal.installer_downloaded", "user", req.user.id, null, null, req.user.id, req);
    res.set("X-Accel-Buffering", "no");
    res.download(join(temporary, "main-pc.zip"), "Madina-Express-Main-PC.zip", () => void rm(temporary, { recursive: true, force: true }));
  } catch (error) {
    await rm(temporary, { recursive: true, force: true });
    throw error;
  }
}));
terminalAdminRouter.post("/devices/:slot/package", route(async (req, res) => {
  await confirmPassword(req);
  if (!config.terminal.local) fail("Open Settings on the main PC’s local address to create child PC setup files.", 409, "local_required");
  const slot = Number(req.params.slot);
  if (![1, 2, 3].includes(slot)) fail("Choose PC 1, 2 or 3.", 422, "invalid_slot");
  const token = randomBytes(32).toString("hex");
  await pool.execute(
    `INSERT INTO terminal_enrollments (slot, token_hash, expires_at, created_by)
     VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 30 MINUTE), ?)
     ON DUPLICATE KEY UPDATE token_hash = ?, expires_at = DATE_ADD(NOW(), INTERVAL 30 MINUTE), created_by = ?`,
    [slot, tokenHash(token), req.user.id, tokenHash(token), req.user.id],
  );
  const ca = await readFile(join(config.terminal.directory, "tls", "ca.crt"));
  const archive = zipSync({
    "Install-Terminal-PC.ps1": bytes(await readFile(resolve("deploy/windows/Install-Terminal-PC.ps1"))),
    "Install-Terminal-PC.cmd": bytes(await readFile(resolve("deploy/windows/Install-Terminal-PC.cmd"))),
    "terminal-ca.cer": new Uint8Array(ca),
    "Change-Terminal-PC-Address.cmd": bytes(await readFile(resolve("deploy/windows/Change-Terminal-PC-Address.cmd"))),
    "Change-Terminal-PC-Address.ps1": bytes(await readFile(resolve("deploy/windows/Change-Terminal-PC-Address.ps1"))),
    "setup.json": bytes(JSON.stringify({
      slot, token, localOrigin: config.terminal.localOrigin, caFingerprint: createHash("sha256").update(ca).digest("hex"),
    })),
  });
  res.set("X-Accel-Buffering", "no");
  res.type("application/zip").attachment(`Madina-Express-PC-${slot}.zip`).send(Buffer.from(archive));
}));
terminalAdminRouter.delete("/devices/:slot", route(async (req, res) => {
  requireAdmin(req);
  if (!config.terminal.local) fail("Manage terminal PCs from the local main PC.", 409, "local_required");
  const slot = Number(req.params.slot);
  if (![1, 2, 3].includes(slot)) fail("Choose a terminal slot.", 422, "invalid_slot");
  await transaction(async connection => {
    await connection.execute("DELETE FROM terminal_devices WHERE slot = ?", [slot]);
    await connection.execute("DELETE FROM terminal_enrollments WHERE slot = ?", [slot]);
    await audit("terminal.revoked", "terminal_device", slot, null, null, req.user.id, req, connection);
  });
  res.json({ ok: true });
}));
