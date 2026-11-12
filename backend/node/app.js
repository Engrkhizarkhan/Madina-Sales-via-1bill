import { terminalAdminRouter, terminalEnrollmentRouter, terminalSyncRouter } from "../terminal/routes.js";
import { cloudAuthorityGuard, terminalState } from "../terminal/state.js";
import { localTerminalGuard } from "../terminal/certificates.js";
import { terminalReady } from "../terminal/runtime.js";
import { readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { CloudSessions } from "./cloud-sessions.js";
import express from "express";
import { updateAdminRouter } from "../update/routes.js";
import { maintenance } from "../update/maintenance.js";
import { releaseInfo } from "../update/version.js";
import bcrypt from "bcryptjs";
import { limitAttempts, sessionHash, accountSessionHash, terminalDevice } from "./access.js";
import { config } from "./config.js";
import { accountVersion, canRemote, isOwner, permittedDevice, requireOwner, newAuthenticator, verifyUserCode } from "./account-access.js";
import { getPolicies, validatePolicies } from "./policies.js";
import { pool, transaction } from "./db.js";
import { ApiError, fail, isoDateTime, pakistanDate, randomToken, requireFields } from "./helpers.js";
import {
  fetchBookings, fetchBuses, fetchCrew,
  fetchExpenses, fetchRoutes, fetchTripRuns, fetchTrips, fetchUsers, lookupJourney, normalizeBookingPhone, publicOccupancy,
} from "./repository.js";
import {
  audit, cancelBooking, confirmReservation, createBooking, createExpense,
  createStaffUser, deleteBus, deleteCrew, deleteRoute, deleteTrip, refundBooking, saveBus, saveCrew, saveRoute, saveTrip,
  transitionTrip, updateBooking, assignDeparture, saveCounterDeparture, updateStaffUser, removeStaffUser,
} from "./operations.js";

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", config.trustProxy);
app.use(localTerminalGuard);

app.use((req, res, next) => {
  const origin = req.get("origin");
  if (origin && config.allowedOrigins.includes(origin)) {
    res.set("Access-Control-Allow-Origin", origin);
    res.set("Access-Control-Allow-Credentials", "true");
    res.vary("Origin");
  }
  res.set({
    "Access-Control-Allow-Headers": "Content-Type, X-CSRF-Token",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    "Cache-Control": "no-store, max-age=0",
  });
  if (origin && !config.allowedOrigins.includes(origin) && !["GET", "HEAD"].includes(req.method)) {
    return res.status(403).json({ error: { code: "origin_denied", message: "This request origin is not allowed." } });
  }
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});
app.use(express.json({ limit: "128kb", strict: true, inflate: false }));
app.use((req, _res, next) => {
  if (req.url === "/index.php") req.url = "/";
  else if (req.url.startsWith("/index.php/")) req.url = req.url.slice(10);
  next();
});

app.use(maintenance.route);
app.use(maintenance.middleware);
app.use("/terminal-sync", terminalSyncRouter);
app.use("/terminal", terminalEnrollmentRouter);
app.use(cloudAuthorityGuard);
app.use((req, res, next) => {
  if (!config.terminal.local || req.path === "/health") return next();
  void terminalReady().then(ready => {
    if (ready) return next();
    res.status(503).json({ error: { code: "terminal_starting", message: "The main PC is completing its initial connection. Please wait." } });
  }).catch(next);
});

const asyncRoute = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
const sessionCookie = config.secureCookies ? "__Host-madina_session" : "madina_session";
const readSessionToken = (req) => (req.get("cookie") || "").split(/;\s*/)
  .find((item) => item.startsWith(`${sessionCookie}=`))
  ?.slice(sessionCookie.length + 1).match(/^[0-9a-f]{64}$/)?.[0];
const publicUser = (user) => ({
  id: Number(user.id), name: user.name, username: user.username,
  role: user.role, email: user.email || "", isOwner: isOwner(user), remoteAllowed: canRemote(user), mfaRequired: isOwner(user) || Boolean(user.mfa_required),
  forcePasswordChange: Boolean(user.force_password_change),
});
const cookieOptions = {
  httpOnly: true, secure: config.secureCookies, sameSite: "lax", path: "/",
};
const passwordMatches = (password, hash) => bcrypt.compare(password, String(hash).replace(/^\$2y\$/, "$2b$"));
const cloudSessions = new CloudSessions(process.env.CLOUD_SESSION_DIRECTORY || resolve("backend", ".cloud-sessions"));
async function loadSession(req) {
  const token = readSessionToken(req);
  if (!token) return null;
  const device = terminalDevice(req);
  const hash = sessionHash(token, "admin", device);
  const saved = config.terminal.cloud ? await cloudSessions.read(hash) : null;
  if (saved) {
    const [[user]] = await pool.execute("SELECT * FROM users WHERE id = ?", [saved.userId || 0]);
    if (!cloudSessions.valid(saved, user)) return null;
    const [[pin]] = await pool.execute("SELECT JSON_UNQUOTE(setting_value) pin_hash FROM settings WHERE setting_key = 'finance_pin_hash'");
    req.cloudSession = saved;
    req.sessionTokenHash = hash;
    req.user = req.session = { ...user, token_hash: hash, csrf_token: saved.csrf,
      finance_unlocked: saved.financeUntil > Date.now() && saved.financeVersion === pin?.pin_hash ? 1 : 0,
      finance_unlocked_until: saved.financeUntil ? new Date(saved.financeUntil) : null };
    return req.user;
  }
  const [records] = await pool.execute(
    `SELECT s.token_hash, s.csrf_token, s.finance_unlocked_until, s.expires_at,
            (s.finance_unlocked_until > NOW() AND EXISTS (
              SELECT 1 FROM settings WHERE setting_key = 'finance_pin_hash'
            )) finance_unlocked,
            u.id, u.name, u.username, u.role, u.active, u.force_password_change, u.email, u.session_version, u.is_owner, u.remote_allowed, u.terminal_slots, u.mfa_required, u.mfa_secret
     FROM api_sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash IN (?, ?) AND s.expires_at > NOW()
       AND s.created_at > DATE_SUB(NOW(), INTERVAL 24 HOUR) LIMIT 1`,
    [sessionHash(token, "admin", device), sessionHash(token, "counter", device)],
  );
  const session = records[0];
  if (!session || !session.active ||
      !permittedDevice(session,device) ||
      session.token_hash !== accountSessionHash(token,session,device)) return null;
  if (req.cloudReadOnly && !canRemote(session)) return null;
  if (!req.cloudReadOnly) await pool.execute("UPDATE api_sessions SET last_activity = NOW(), expires_at = DATE_ADD(NOW(), INTERVAL 8 HOUR) WHERE token_hash = ? AND last_activity < DATE_SUB(NOW(), INTERVAL 5 MINUTE)", [session.token_hash]);
  req.sessionTokenHash = session.token_hash;
  req.session = session;
  req.user = session;
  return session;
}

async function requireAuth(req) {
  const user = req.user || await loadSession(req);
  if (!user) fail("Authentication is required.", 401, "unauthenticated");
  return user;
}
const requireRole = (user, roles) => {
  if (!roles.includes(user.role)) fail("You do not have permission for this action.", 403, "forbidden");
};
const requireCsrf = (req) => {
  const provided = req.get("X-CSRF-Token") || "";
  if (!req.session?.csrf_token || provided !== req.session.csrf_token) {
    fail("The security token is missing or expired. Please sign in again.", 403, "csrf_failed");
  }
};

async function createSession(connection, req, user) {
  await connection.execute("DELETE FROM api_sessions WHERE expires_at <= NOW()");
  const token = randomToken();
  const csrf = randomToken();
  await connection.execute(
    `INSERT INTO api_sessions (token_hash, user_id, csrf_token, last_activity, expires_at, ip_address, user_agent)
     VALUES (?, ?, ?, NOW(), DATE_ADD(NOW(), INTERVAL 8 HOUR), ?, ?)`,
    [accountSessionHash(token,user,terminalDevice(req)), user.id, csrf, String(req.ip || "unknown").slice(0, 64), String(req.get("user-agent") || "").slice(0, 255)],
  );
  return { token, csrfToken: csrf };
}

app.get("/health", asyncRoute(async (_req, res) => {
  await pool.query("SELECT 1");
  res.json({ status: "ok", database: "connected", runtime: "node", time: new Date().toISOString(), release:releaseInfo, paymentMode: config.paymentMode,
    ...(config.terminal.local ? { installationId: process.env.TERMINAL_INSTALLATION_ID } : {}) });
}));

app.post("/auth/login", asyncRoute(async (req, res) => {
  limitAttempts("login", req, 35, 15 * 60_000);
  const { identity: input, password, otp } = req.body || {};
  if (typeof input !== "string" || !input.trim() || input.length > 190 ||
      typeof password !== "string" || !password || Buffer.byteLength(password) > 72) {
    fail("The username or password is incorrect.", 401, "invalid_credentials");
  }
  const identity = input.trim().toLowerCase();
  const [records] = await pool.execute(
    "SELECT * FROM users WHERE username = ? OR email = ? LIMIT 1",
    [identity, identity],
  );
  const user = records[0];
  if (!user || !user.active || !(await passwordMatches(password, user.password_hash))) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    fail("The username or password is incorrect.", 401, "invalid_credentials");
  }
  if (!permittedDevice(user,terminalDevice(req))) {
    fail("Sign in from an approved terminal PC. Ask your administrator to enroll the PC in Settings → Staff access.", 403, "terminal_required");
  }
  if (isOwner(user) && verifyUserCode(user,otp) === false) {
    fail("Enter a current code from the administrator's authenticator app.", 401, "authenticator_required");
  }
  if (req.cloudReadOnly) {
    if (!canRemote(user)) fail("Use the terminal's local address to sign in as staff.", 403, "terminal_required");
    {
      const step = verifyUserCode(user,otp);
      if (step === false) fail("Enter a current code from this account's authenticator app.",401,"authenticator_required");
      if (step !== null) await cloudSessions.consumeOtp(user.id,step);
    }
    const oldToken = readSessionToken(req);
    if (oldToken) await cloudSessions.revoke(sessionHash(oldToken, "admin", ""));
    const token = randomToken(), csrfToken = randomToken();
    await cloudSessions.create(sessionHash(token, "admin", ""), user, csrfToken);
    res.cookie(sessionCookie, token, cookieOptions);
    return res.json({ user: publicUser(user), csrfToken });
  }
  const oldSession = await loadSession(req);
  if (req.cloudSession && oldSession) await cloudSessions.revoke(oldSession.token_hash);
  const session = await transaction(async (connection) => {
    const [[current]] = await connection.execute(
      "SELECT * FROM users WHERE id = ? FOR UPDATE", [user.id],
    );
    if (!current?.active || accountVersion(current) !== accountVersion(user) || current.username !== user.username) {
      fail("The username or password is incorrect.", 401, "invalid_credentials");
    }
    {
      const step = verifyUserCode(current,otp);
      if (step === false) fail("Enter a current code from this account's authenticator app.",401,"authenticator_required");
      if (step !== null) await connection.execute("UPDATE users SET mfa_last_step=? WHERE id=?",[step,current.id]);
    }
    if (oldSession) await connection.execute("DELETE FROM api_sessions WHERE token_hash = ?", [oldSession.token_hash]);
    await connection.execute("UPDATE users SET failed_login_count = 0, locked_until = NULL, last_login_at = NOW() WHERE id = ?", [current.id]);
    const created = await createSession(connection, req, current);
    await audit("auth.login", "user", current.id, null, { success: true }, current.id, req, connection);
    return { ...created, user: publicUser(current) };
  });
  res.cookie(sessionCookie, session.token, cookieOptions);
  res.json({ user: session.user, csrfToken: session.csrfToken });
}));

app.get("/public/bootstrap", asyncRoute(async (_req, res) => {
  const policy=await getPolicies();
  if (!config.publicSiteEnabled) fail("Public booking is temporarily unavailable.", 404, "public_site_disabled");
  res.json({ fleet: await fetchBuses(true), trips: await fetchTrips(true), routes: await fetchRoutes(true), occupancy: await publicOccupancy(pakistanDate()), reservationPolicy:{maxSeats:policy.publicMaxSeats,expiryEnabled:policy.publicExpiryEnabled,expiryHours:policy.publicExpiryHours}, terminalAvailable:policy.publicReservationsEnabled && !["preparing", "active"].includes((await terminalState()).phase) });
}));

app.get("/public/trip-runs", asyncRoute(async (req, res) => {
  const policy=await getPolicies();
  if (!config.publicSiteEnabled) fail("Public booking is temporarily unavailable.", 404, "public_site_disabled");
  const date = String(req.query.date || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) fail("Choose a valid travel date.", 422, "validation_error");
  const runs = await fetchTripRuns(date);
  res.json({ runs: runs.map((run) => ({ id: run.id, tripId: run.tripId, date: run.date, runNumber: run.runNumber,
    busId: run.busId, status: run.status, salesPaused:run.salesPaused, salesOverride:false, snapshot: run.snapshot ? { routeId: run.snapshot.routeId, departure: run.snapshot.departure, arrival: run.snapshot.arrival, bus: run.snapshot.bus, route: run.snapshot.route } : null })), occupancy: await publicOccupancy(date), fleet: await fetchBuses(true), trips: await fetchTrips(true), routes: await fetchRoutes(true), terminalAvailable: policy.publicReservationsEnabled && !["preparing", "active"].includes((await terminalState()).phase) });
}));

app.post("/public/bookings", asyncRoute(async (req, res) => {
  if (!config.publicSiteEnabled) fail("Public booking is temporarily unavailable.", 404, "public_site_disabled");
  limitAttempts("reservation", req, 30, 10 * 60_000);
  if (!req.body || Array.isArray(req.body)) fail("Enter the reservation details.", 422, "validation_error");
  const records = await createBooking(req.body, null, true, req);
  const bookings = records.map(({ ticketNo, passenger, route, destination, boardingPoint, service, seats, total, date, time, expiresAt }) =>
    ({ ticketNo, passenger, route, destination, boardingPoint, service, seats, total, date, time, expiresAt }));
  res.status(201).json({ bookings });
}));

app.post("/public/ticket-lookup", asyncRoute(async (req, res) => {
  if (!config.publicSiteEnabled) fail("Public booking is temporarily unavailable.", 404, "public_site_disabled");
  limitAttempts("ticket-lookup", req, 20, 10 * 60_000);
  const reference = typeof req.body?.reference === "string" ? req.body.reference.trim().toUpperCase() : "";
  const phone = normalizeBookingPhone(req.body?.phone);
  if (reference.length > 40 || !/^(?:ME|RS)-[0-9A-Z]+(?:-[0-9A-Z]+)*$/.test(reference) || !phone) {
    fail("Enter your ticket or reservation reference and the mobile number used for the booking.", 422, "validation_error");
  }
  const journey = await lookupJourney(reference, phone);
  if (!journey) fail("No journey matches that reference and mobile number. Check both and try again.", 404, "not_found");
  res.json({ journey });
}));

app.use(asyncRoute(async (req, _res, next) => {
  await requireAuth(req);
  if (!["GET", "HEAD"].includes(req.method)) requireCsrf(req);
  if (req.user.force_password_change && !["/auth/me", "/admin/bootstrap", "/auth/change-password", "/auth/logout"].includes(req.path)) {
    fail("Change the temporary password to access operations.", 403, "password_change_required");
  }
  next();
}));

app.use("/terminal", terminalAdminRouter);
app.use("/updates",updateAdminRouter);

app.get("/auth/me", asyncRoute(async (req, res) => res.json({ user: publicUser(req.user), csrfToken: req.session.csrf_token })));

app.post("/auth/logout", asyncRoute(async (req, res) => {
  if (req.cloudReadOnly || req.cloudSession) await cloudSessions.revoke(req.sessionTokenHash);
  if (!req.cloudReadOnly) {
    await audit("auth.logout", "user", req.user.id, null, { success: true }, req.user.id, req);
    await pool.execute("DELETE FROM api_sessions WHERE token_hash = ?", [req.sessionTokenHash]);
  }
  res.clearCookie(sessionCookie, cookieOptions);
  res.json({ ok: true });
}));

app.post("/auth/change-password", asyncRoute(async (req, res) => {
  requireFields(req.body, ["currentPassword", "newPassword"]);
  const [records] = await pool.execute("SELECT password_hash FROM users WHERE id = ?", [req.user.id]);
  if (!(await passwordMatches(String(req.body.currentPassword), records[0]?.password_hash || ""))) fail("The current password is incorrect.", 422, "invalid_password");
  const password = String(req.body.newPassword);
  if (password.length < 12 || Buffer.byteLength(password) > 72 || !/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/\d/.test(password) || !/[^A-Za-z0-9]/.test(password)) {
    fail("Use at least 12 characters with upper-case, lower-case, number and symbol.", 422, "weak_password");
  }
  const csrfToken = randomToken();
  await transaction(async (connection) => {
    await connection.execute("UPDATE users SET password_hash = ?, force_password_change = 0 WHERE id = ?", [await bcrypt.hash(password, 12), req.user.id]);
    await connection.execute("DELETE FROM api_sessions WHERE user_id = ? AND token_hash <> ?", [req.user.id, req.sessionTokenHash]);
    await connection.execute("UPDATE api_sessions SET csrf_token = ?, finance_unlocked_until = NULL WHERE token_hash = ?", [csrfToken, req.sessionTokenHash]);
    await audit("auth.password_changed", "user", req.user.id, null, { success: true }, req.user.id, req, connection);
  });
  res.json({ ok: true, csrfToken });
}));

app.get("/admin/bootstrap", asyncRoute(async (req, res) => {
  if (req.user.force_password_change) {
    return res.json({ bookings: [], fleet: [], trips: [], runs: [], routes: [], crew: [], users: [],
      user: publicUser(req.user), paymentMode: config.paymentMode });
  }
  const trips = await fetchTrips();
  const runs = await fetchTripRuns();
  const todayTrips = trips.map((trip) => {
    const run = runs.find((item) => item.tripId === trip.id && item.date === pakistanDate());
    return run ? { ...trip, status: run.status, runNumber: run.runNumber } : { ...trip, status: "Scheduled", runNumber: 1 };
  });
  res.json({
    bookings: await fetchBookings(), fleet: await fetchBuses(), trips: todayTrips, runs, routes: await fetchRoutes(),
    crew: await fetchCrew(), users: isOwner(req.user) ? await fetchUsers() : [],
    user: publicUser(req.user), release:releaseInfo, policies:await getPolicies(), paymentMode: config.paymentMode, readOnly: Boolean(req.cloudReadOnly),
  });
}));

const financePinKey = "finance_pin_hash";
async function financePinHash(executor, lock = false) {
  const [[record]] = await executor.execute(
    `SELECT JSON_UNQUOTE(setting_value) AS pin_hash FROM settings WHERE setting_key = ? ${lock ? "FOR SHARE" : ""}`,
    [financePinKey],
  );
  return record?.pin_hash;
}

app.post("/auth/finance-unlock", asyncRoute(async (req, res) => {
  requireRole(req.user, ["admin"]);
  limitAttempts("finance", req, 20, 15 * 60_000);
  const pin = req.body?.pin;
  if (typeof pin !== "string" || !/^\d{6,10}$/.test(pin)) fail("Enter the finance PIN.", 422, "invalid_pin");
  if (req.cloudReadOnly || req.cloudSession) {
    const hash = await financePinHash(pool);
    if (!hash) fail("Set a finance PIN in Settings first.", 409, "finance_pin_not_set");
    if (!(await passwordMatches(pin, hash))) fail("The finance PIN is incorrect.", 422, "invalid_pin");
    if (!req.cloudSession) {
      const [[user]] = await pool.execute("SELECT * FROM users WHERE id = ?", [req.user.id]);
      await cloudSessions.create(req.sessionTokenHash, user, req.session.csrf_token);
    }
    await cloudSessions.change(req.sessionTokenHash, current => {
      if (!current || current.revoked || current.expires <= Date.now()) fail("Please sign in again.", 401, "unauthenticated");
      return { ...current, financeUntil: Date.now() + 900000, financeVersion: hash };
    });
    return res.json({ unlocked: true, expiresIn: 900 });
  }
  const unlocked = await transaction(async (connection) => {
    const hash = await financePinHash(connection, true);
    if (!hash) fail("Set a finance PIN in Settings first.", 409, "finance_pin_not_set");
    if (!(await passwordMatches(pin, hash))) return false;
    const [result] = await connection.execute(
      "UPDATE api_sessions SET finance_unlocked_until = DATE_ADD(NOW(), INTERVAL 15 MINUTE) WHERE token_hash = ?",
      [req.sessionTokenHash],
    );
    if (!result.affectedRows) fail("Please sign in again.", 401, "unauthenticated");
    await audit("finance.unlocked", "user", req.user.id, null, { duration_minutes: 15 }, req.user.id, req, connection);
    return true;
  });
  if (!unlocked) {
    await audit("finance.unlock_failed", "user", req.user.id, null, { success: false }, req.user.id, req);
    fail("The finance PIN is incorrect.", 422, "invalid_pin");
  }
  res.json({ unlocked: true, expiresIn: 900 });
}));

const financeUnlocked = (req) => Boolean(Number(req.session.finance_unlocked));
app.get("/finance/status", asyncRoute(async (req, res) => {
  requireRole(req.user, ["admin"]);
  const pinConfigured = Boolean(await financePinHash(pool));
  const expiresIn = pinConfigured && financeUnlocked(req)
    ? Math.max(0, Math.floor(((req.cloudSession?.financeUntil ?? Date.parse(isoDateTime(req.session.finance_unlocked_until))) - Date.now()) / 1000)) : 0;
  res.json({ unlocked: expiresIn > 0, expiresIn, pinConfigured });
}));

app.put("/finance/pin", asyncRoute(async (req, res) => {
  requireOwner(req.user);
  limitAttempts("finance-pin-change", req, 15, 15 * 60_000);
  const { pin, currentPassword } = req.body || {};
  if (typeof pin !== "string" || !/^\d{6,10}$/.test(pin)) {
    fail("Use a finance PIN with 6–10 digits.", 422, "invalid_pin");
  }
  if (typeof currentPassword !== "string" || !currentPassword || Buffer.byteLength(currentPassword) > 72) {
    fail("Enter your current administrator password.", 422, "invalid_password");
  }
  const hash = await bcrypt.hash(pin, 12);
  await transaction(async (connection) => {
    const [[admin]] = await connection.execute("SELECT password_hash FROM users WHERE id = ? AND active = 1 FOR UPDATE", [req.user.id]);
    if (!admin || !(await passwordMatches(currentPassword, admin.password_hash))) {
      fail("The administrator password is incorrect.", 422, "invalid_password");
    }
    await connection.execute(
      `INSERT INTO settings (setting_key, setting_value, updated_by) VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE setting_value = ?, updated_by = ?`,
      [financePinKey, JSON.stringify(hash), req.user.id, JSON.stringify(hash), req.user.id],
    );
    await connection.execute("UPDATE api_sessions SET finance_unlocked_until = NULL WHERE finance_unlocked_until IS NOT NULL");
    await audit("finance.pin_changed", "user", req.user.id, null, null, req.user.id, req, connection);
  });
  res.json({ ok: true });
}));

app.post("/bookings", asyncRoute(async (req, res) => {
  requireRole(req.user, ["admin", "manager", "counter"]);
  const bookings = await createBooking(req.body, req.user, false, req);
  res.status(201).json({ booking: bookings[0], bookings });
}));
app.put("/bookings/:id", asyncRoute(async (req, res) => {
  requireRole(req.user, ["admin", "manager", "counter"]);
  res.json({ booking: await updateBooking(req.params.id, req.body, req.user, req) });
}));
app.post("/bookings/:id/cancel", asyncRoute(async (req, res) => {
  requireRole(req.user, ["admin", "manager", "counter"]);
  res.json({ booking: await cancelBooking(req.params.id, req.user, req) });
}));
app.post("/bookings/:id/confirm", asyncRoute(async (req, res) => {
  requireRole(req.user, ["admin", "manager", "counter"]);
  res.json({ booking: await confirmReservation(req.params.id, req.body, req.user, req) });
}));
app.post("/bookings/:id/refunds", asyncRoute(async (req, res) => {
  requireRole(req.user, ["admin", "manager", "counter", "finance"]);
  res.status(201).json({ booking: await refundBooking(req.params.id, req.body, req.user, req) });
}));

app.post("/routes/:id", asyncRoute(async (req, res) => { requireRole(req.user, ["admin", "manager"]); res.json({ route: await saveRoute(req.params.id, req.body, req.user, req) }); }));
app.put("/routes/:id", asyncRoute(async (req, res) => { requireRole(req.user, ["admin", "manager"]); res.json({ route: await saveRoute(req.params.id, req.body, req.user, req) }); }));
app.delete("/routes/:id", asyncRoute(async (req, res) => { requireRole(req.user, ["admin", "manager"]); await deleteRoute(req.params.id, req.user, req); res.json({ ok: true }); }));
app.post("/buses/:id", asyncRoute(async (req, res) => { requireRole(req.user, ["admin", "manager", "dispatcher"]); res.json({ bus: await saveBus(req.params.id, req.body, req.user, req) }); }));
app.put("/buses/:id", asyncRoute(async (req, res) => { requireRole(req.user, ["admin", "manager", "dispatcher"]); res.json({ bus: await saveBus(req.params.id, req.body, req.user, req) }); }));
app.delete("/buses/:id", asyncRoute(async (req, res) => { requireRole(req.user, ["admin", "manager", "dispatcher"]); await deleteBus(req.params.id, req.user, req); res.json({ ok: true }); }));
app.post("/trips/:id", asyncRoute(async (req, res) => { requireRole(req.user, ["admin", "manager", "dispatcher"]); res.json({ trip: await saveTrip(req.params.id, req.body, req.user, req) }); }));
app.put("/trips/:id", asyncRoute(async (req, res) => { requireRole(req.user, ["admin", "manager", "dispatcher"]); res.json({ trip: await saveTrip(req.params.id, req.body, req.user, req) }); }));
app.delete("/trips/:id", asyncRoute(async (req, res) => { requireRole(req.user, ["admin", "manager", "dispatcher"]); await deleteTrip(req.params.id, req.user, req); res.json({ ok: true }); }));
app.post("/trips/:id/transition", asyncRoute(async (req, res) => { requireRole(req.user, ["admin", "manager", "counter", "dispatcher"]); res.json({ trip: await transitionTrip(req.params.id, req.body, req.user, req) }); }));
app.put('/trips/:id/assignment', asyncRoute(async (req,res) => {
  requireRole(req.user,['admin','manager','counter','dispatcher']);
  res.json({trip:await assignDeparture(req.params.id,req.body,req.user,req)});
}));
app.put('/trips/:id/counter', asyncRoute(async (req, res) => {
  requireRole(req.user, ['admin', 'manager', 'counter', 'dispatcher']);
  res.json({trip: await saveCounterDeparture(req.params.id, req.body, req.user, req)});
}));
app.get("/trip-runs", asyncRoute(async (req, res) => {
  requireRole(req.user, ["admin", "manager", "counter", "dispatcher"]);
  const date = String(req.query.date || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) fail("Choose a valid service date.", 422, "validation_error");
  res.json({ runs: await fetchTripRuns(date) });
}));
app.post("/crew/:key", asyncRoute(async (req, res) => { requireRole(req.user, ["admin", "manager", "dispatcher"]); res.json({ person: await saveCrew(req.params.key, req.body, req.user, req) }); }));
app.put("/crew/:key", asyncRoute(async (req, res) => { requireRole(req.user, ["admin", "manager", "dispatcher"]); res.json({ person: await saveCrew(req.params.key, req.body, req.user, req) }); }));
app.delete("/crew/:id", asyncRoute(async (req, res) => { requireRole(req.user, ["admin", "manager", "dispatcher"]); await deleteCrew(req.params.id, req.user, req); res.json({ ok: true }); }));

app.get("/expenses", asyncRoute(async (req, res) => {
  requireRole(req.user, ["admin"]);
  if (!financeUnlocked(req)) fail("Enter the finance PIN to view finance.", 403, "finance_locked");
  res.json({ expenses: await fetchExpenses() });
}));
app.post("/expenses", asyncRoute(async (req, res) => {
  requireRole(req.user, ["admin"]);
  if (!financeUnlocked(req)) fail("Enter the finance PIN to view finance.", 403, "finance_locked");
  res.status(201).json({ expense: await createExpense(req.body, req.user, req) });
}));

app.get("/audit", asyncRoute(async (req, res) => {
  requireRole(req.user, ["admin", "manager"]);
  const [events] = await pool.query("SELECT a.id, a.action, a.entity_type, a.entity_id, a.before_json, a.after_json, a.ip_address, a.created_at, u.name user_name FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id ORDER BY a.id DESC LIMIT 200");
  res.json({ events });
}));
app.post("/users", asyncRoute(async (req, res) => { requireOwner(req.user); res.status(201).json({ user: await createStaffUser(req.body, req.user, req) }); }));

app.put("/users/:id", asyncRoute(async (req, res) => {
  requireOwner(req.user);
  res.json({ user: await updateStaffUser(req.params.id, req.body, req.user, req) });
}));
app.delete("/users/:id", asyncRoute(async (req, res) => {
  requireOwner(req.user);
  await removeStaffUser(req.params.id, req.user, req);
  res.json({ ok: true });
}));

app.get("/settings/policies", asyncRoute(async (_req,res) => res.json({ policies: await getPolicies() })));
app.put("/settings/policies", asyncRoute(async (req,res) => {
  requireOwner(req.user);
  const policies = validatePolicies(req.body);
  await transaction(async connection => {
    const before = await getPolicies(connection);
    await connection.execute("INSERT INTO settings (setting_key,setting_value,updated_by) VALUES ('booking_policies',?,?) ON DUPLICATE KEY UPDATE setting_value=VALUES(setting_value),updated_by=VALUES(updated_by)",[JSON.stringify(policies),req.user.id]);
    await audit('policies.updated','settings','booking_policies',before,policies,req.user.id,req,connection);
  });
  res.json({ policies });
}));
app.post("/users/:id/revoke", asyncRoute(async (req,res) => {
  requireOwner(req.user);
  await transaction(async connection => {
    const [[account]] = await connection.execute('SELECT is_owner FROM users WHERE id=? AND active=1 FOR UPDATE',[req.params.id]);
    if (!account) fail('Account not found.',404,'not_found');
    if (account.is_owner) fail('The main administrator is protected.',403,'admin_protected');
    await connection.execute('UPDATE users SET session_version=session_version+1 WHERE id=?',[req.params.id]);
    await connection.execute('DELETE FROM api_sessions WHERE user_id=?',[req.params.id]);
    await audit('user.sessions_revoked','user',req.params.id,null,null,req.user.id,req,connection);
  });
  res.json({ok:true});
}));
app.post("/users/:id/authenticator", asyncRoute(async (req,res) => {
  requireOwner(req.user);
  if (typeof req.body?.enabled !== 'boolean') fail('Choose whether an authenticator is required.',422,'validation_error');
  const setup = await transaction(async connection => {
    const [[account]] = await connection.execute("SELECT * FROM users WHERE id=? AND active=1 FOR UPDATE",[req.params.id]);
    if (!account) fail('Account not found.',404,'not_found');
    if (isOwner(account)) fail('The main administrator authenticator is protected.',403,'admin_protected');
    const enrollment = req.body.enabled ? newAuthenticator(account.username) : null;
    await connection.execute("UPDATE users SET mfa_required=?,mfa_secret=?,mfa_last_step=-1,session_version=session_version+1 WHERE id=?",[req.body.enabled,enrollment?.encrypted||null,account.id]);
    await connection.execute("DELETE FROM api_sessions WHERE user_id=?",[account.id]);
    await audit('user.authenticator_changed','user',account.id,null,{enabled:req.body.enabled},req.user.id,req,connection);
    return enrollment ? { secret:enrollment.secret,uri:enrollment.uri } : null;
  });
  res.json({ setup, user:(await fetchUsers(pool,Number(req.params.id)))[0] });
}));

app.get("/users/terminal-access", asyncRoute(async (req, res) => {
  requireRole(req.user, ["admin"]);
  if (config.terminal.local) {
    const [devices] = await pool.execute("SELECT slot FROM terminal_devices WHERE expires_at > NOW()");
    return res.json({ enforced: true, terminals: [1, 2, 3].map(slot => ({
      slot, enrolled: devices.some(device => device.slot === slot),
    })) });
  }
  const files = config.restrictStaffDevices
    ? await readdir("/etc/nginx/madina-terminal-devices").catch(error => {
        if (error.code === "ENOENT") return [];
        throw error;
      })
    : [];
  res.json({ enforced: config.restrictStaffDevices, terminals: [1, 2, 3].map(slot => ({
    slot, enrolled: files.includes(`terminal-${slot}.conf`),
  })) });
}));

app.use((_req, _res, next) => next(new ApiError("API route not found.", 404, "not_found")));
app.use((error, _req, res, _next) => {
  if (error?.type === "entity.parse.failed") return res.status(400).json({ error: { code: "invalid_json", message: "Request body must be valid JSON." } });
  if (error?.type === "encoding.unsupported") return res.status(415).json({ error: { code: "unsupported_encoding", message: "Use an uncompressed JSON request." } });
  if (error?.type === "entity.too.large") return res.status(413).json({ error: { code: "request_too_large", message: "Request body is too large." } });
  if (error instanceof ApiError) return res.status(error.status).json({ error: { code: error.code, message: error.message } });
  if (error?.code === "ER_DUP_ENTRY") return res.status(409).json({ error: { code: "duplicate_record", message: "That record conflicts with an existing record." } });
  console.error(error);
  const message = config.env === "production" ? "The server could not complete the request." : error.message;
  return res.status(500).json({ error: { code: "server_error", message } });
});

export { app };
