import express from "express";
import bcrypt from "bcryptjs";
import { config } from "./config.js";
import { pool, transaction } from "./db.js";
import { ApiError, fail, isoDateTime, randomToken, requireFields, sqlDateTime, tokenHash } from "./helpers.js";
import {
  expireReservations, fetchBookings, fetchBuses, fetchCrew, fetchCurrentShift,
  fetchExpenses, fetchRoutes, fetchTrips, fetchUsers, publicOccupancy,
} from "./repository.js";
import {
  audit, cancelBooking, closeShift, confirmReservation, createBooking, createExpense,
  createStaffUser, openShift, refundBooking, saveBus, saveCrew, saveRoute, saveTrip,
  transitionTrip, updateBooking,
} from "./operations.js";

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", "loopback");

app.use((req, res, next) => {
  const origin = req.get("origin");
  if (origin && config.allowedOrigins.includes(origin)) {
    res.set("Access-Control-Allow-Origin", origin);
    res.set("Access-Control-Allow-Credentials", "true");
    res.vary("Origin");
  }
  res.set({
    "Access-Control-Allow-Headers": "Content-Type, X-CSRF-Token",
    "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    "Cache-Control": "no-store, max-age=0",
  });
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});
app.use(express.json({ limit: "1mb", strict: true }));
app.use((req, _res, next) => {
  if (req.url === "/index.php") req.url = "/";
  else if (req.url.startsWith("/index.php/")) req.url = req.url.slice(10);
  next();
});

const asyncRoute = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
const cookies = (req) => Object.fromEntries((req.get("cookie") || "").split(";").map((item) => item.trim()).filter(Boolean).map((item) => {
  const index = item.indexOf("=");
  return [decodeURIComponent(item.slice(0, index)), decodeURIComponent(item.slice(index + 1))];
}));
const publicUser = (user) => ({
  id: Number(user.id), name: user.name, email: user.email, username: user.username,
  role: user.role, forcePasswordChange: Boolean(user.force_password_change),
});
const cookieOptions = {
  httpOnly: true, secure: config.secureCookies, sameSite: "lax", path: "/",
};
const passwordMatches = (password, hash) => bcrypt.compare(password, String(hash).replace(/^\$2y\$/, "$2b$"));

async function loadSession(req) {
  const token = cookies(req).madina_session;
  if (!token) return null;
  const [records] = await pool.execute(
    `SELECT s.token_hash, s.csrf_token, s.finance_unlocked_until, s.expires_at,
            u.id, u.name, u.email, u.username, u.role, u.active, u.force_password_change
     FROM api_sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ? AND s.expires_at > NOW() LIMIT 1`, [tokenHash(token)],
  );
  const session = records[0];
  if (!session || !session.active) return null;
  await pool.execute("UPDATE api_sessions SET last_activity = NOW(), expires_at = DATE_ADD(NOW(), INTERVAL 8 HOUR) WHERE token_hash = ?", [session.token_hash]);
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

async function createSession(req, res, userId) {
  await pool.execute("DELETE FROM api_sessions WHERE expires_at <= NOW()");
  const token = randomToken();
  const csrf = randomToken();
  await pool.execute(
    `INSERT INTO api_sessions (token_hash, user_id, csrf_token, last_activity, expires_at, ip_address, user_agent)
     VALUES (?, ?, ?, NOW(), DATE_ADD(NOW(), INTERVAL 8 HOUR), ?, ?)`,
    [tokenHash(token), userId, csrf, String(req.ip || "unknown").slice(0, 64), String(req.get("user-agent") || "").slice(0, 255)],
  );
  res.cookie("madina_session", token, cookieOptions);
  return csrf;
}

app.get("/health", asyncRoute(async (_req, res) => {
  await pool.query("SELECT 1");
  res.json({ status: "ok", database: "connected", runtime: "node", time: new Date().toISOString(), paymentMode: config.paymentMode });
}));

app.post("/auth/login", asyncRoute(async (req, res) => {
  requireFields(req.body, ["identity", "password"]);
  const identity = String(req.body.identity).trim().toLowerCase();
  const [records] = await pool.execute("SELECT * FROM users WHERE email = ? OR username = ? LIMIT 1", [identity, identity]);
  const user = records[0];
  if (user?.locked_until && new Date(`${user.locked_until.replace(" ", "T")}+05:00`) > new Date()) {
    fail("Too many failed attempts. Try again later.", 429, "account_locked");
  }
  if (!user || !user.active || !(await passwordMatches(String(req.body.password), user.password_hash))) {
    if (user) {
      const attempts = Number(user.failed_login_count) + 1;
      await pool.execute("UPDATE users SET failed_login_count = ?, locked_until = ? WHERE id = ?",
        [attempts, attempts >= 5 ? sqlDateTime(new Date(Date.now() + 900_000)) : null, user.id]);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
    fail("The username or password is incorrect.", 401, "invalid_credentials");
  }
  const oldToken = cookies(req).madina_session;
  if (oldToken) await pool.execute("DELETE FROM api_sessions WHERE token_hash = ?", [tokenHash(oldToken)]);
  await pool.execute("UPDATE users SET failed_login_count = 0, locked_until = NULL, last_login_at = NOW() WHERE id = ?", [user.id]);
  const csrfToken = await createSession(req, res, user.id);
  await audit("auth.login", "user", user.id, null, { success: true }, user.id, req);
  res.json({ user: publicUser(user), csrfToken });
}));

app.get("/public/bootstrap", asyncRoute(async (_req, res) => {
  if (!config.publicSiteEnabled) fail("Public booking is temporarily unavailable.", 404, "public_site_disabled");
  await expireReservations();
  res.json({ fleet: await fetchBuses(true), trips: await fetchTrips(true), routes: await fetchRoutes(true), occupancy: await publicOccupancy(), paymentMode: config.paymentMode });
}));

app.post("/public/bookings", asyncRoute(async (req, res) => {
  if (!config.publicSiteEnabled) fail("Public booking is temporarily unavailable.", 404, "public_site_disabled");
  if (config.paymentMode !== "demo") fail("Online payments are not configured. Please book at the counter.", 503, "payment_unavailable");
  res.status(201).json({ booking: await createBooking(req.body, null, true, req) });
}));

app.use(asyncRoute(async (req, _res, next) => {
  await requireAuth(req);
  if (req.method !== "GET") {
    requireCsrf(req);
    if (req.user.force_password_change && !["/auth/change-password", "/auth/logout"].includes(req.path)) {
      fail("Change the temporary password before making operational changes.", 403, "password_change_required");
    }
  }
  next();
}));

app.get("/auth/me", asyncRoute(async (req, res) => res.json({ user: publicUser(req.user), csrfToken: req.session.csrf_token })));

app.post("/auth/logout", asyncRoute(async (req, res) => {
  await audit("auth.logout", "user", req.user.id, null, { success: true }, req.user.id, req);
  await pool.execute("DELETE FROM api_sessions WHERE token_hash = ?", [req.sessionTokenHash]);
  res.clearCookie("madina_session", cookieOptions);
  res.json({ ok: true });
}));

app.post("/auth/change-password", asyncRoute(async (req, res) => {
  requireFields(req.body, ["currentPassword", "newPassword"]);
  const [records] = await pool.execute("SELECT password_hash FROM users WHERE id = ?", [req.user.id]);
  if (!(await passwordMatches(String(req.body.currentPassword), records[0]?.password_hash || ""))) fail("The current password is incorrect.", 422, "invalid_password");
  const password = String(req.body.newPassword);
  if (password.length < 12 || !/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/\d/.test(password) || !/[^A-Za-z0-9]/.test(password)) {
    fail("Use at least 12 characters with upper-case, lower-case, number and symbol.", 422, "weak_password");
  }
  const csrfToken = randomToken();
  await transaction(async (connection) => {
    await connection.execute("UPDATE users SET password_hash = ?, force_password_change = 0 WHERE id = ?", [await bcrypt.hash(password, 12), req.user.id]);
    await connection.execute("UPDATE api_sessions SET csrf_token = ?, finance_unlocked_until = NULL WHERE token_hash = ?", [csrfToken, req.sessionTokenHash]);
    await audit("auth.password_changed", "user", req.user.id, null, { success: true }, req.user.id, req, connection);
  });
  res.json({ ok: true, csrfToken });
}));

app.get("/admin/bootstrap", asyncRoute(async (req, res) => {
  await expireReservations();
  res.json({
    bookings: await fetchBookings(), fleet: await fetchBuses(), trips: await fetchTrips(), routes: await fetchRoutes(),
    crew: await fetchCrew(), users: req.user.role === "admin" ? await fetchUsers() : [],
    shift: await fetchCurrentShift(Number(req.user.id)), user: publicUser(req.user), paymentMode: config.paymentMode,
  });
}));

app.post("/auth/finance-unlock", asyncRoute(async (req, res) => {
  requireRole(req.user, ["admin"]);
  requireFields(req.body, ["password"]);
  const [records] = await pool.execute("SELECT password_hash FROM users WHERE id = ? AND role = 'admin' AND active = 1 LIMIT 1", [req.user.id]);
  if (!(await passwordMatches(String(req.body.password), records[0]?.password_hash || ""))) {
    await audit("finance.unlock_failed", "user", req.user.id, null, { success: false }, req.user.id, req);
    fail("The administrator password is incorrect.", 422, "invalid_password");
  }
  await pool.execute("UPDATE api_sessions SET finance_unlocked_until = DATE_ADD(NOW(), INTERVAL 15 MINUTE) WHERE token_hash = ?", [req.sessionTokenHash]);
  await audit("finance.unlocked", "user", req.user.id, null, { duration_minutes: 15 }, req.user.id, req);
  res.json({ unlocked: true, expiresIn: 900 });
}));

const financeUnlocked = (req) => req.session.finance_unlocked_until && new Date(`${req.session.finance_unlocked_until.replace(" ", "T")}+05:00`) > new Date();
app.get("/finance/status", (req, res) => {
  requireRole(req.user, ["admin"]);
  res.json({ unlocked: Boolean(financeUnlocked(req)) });
});

app.post("/bookings", asyncRoute(async (req, res) => {
  requireRole(req.user, ["admin", "manager", "counter"]);
  res.status(201).json({ booking: await createBooking(req.body, req.user, false, req) });
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
  requireRole(req.user, ["admin", "manager", "finance"]);
  res.status(201).json({ booking: await refundBooking(req.params.id, req.body, req.user, req) });
}));

app.post("/routes/:id", asyncRoute(async (req, res) => { requireRole(req.user, ["admin", "manager"]); res.json({ route: await saveRoute(req.params.id, req.body, req.user, req) }); }));
app.put("/routes/:id", asyncRoute(async (req, res) => { requireRole(req.user, ["admin", "manager"]); res.json({ route: await saveRoute(req.params.id, req.body, req.user, req) }); }));
app.post("/buses/:id", asyncRoute(async (req, res) => { requireRole(req.user, ["admin", "manager", "dispatcher"]); res.json({ bus: await saveBus(req.params.id, req.body, req.user, req) }); }));
app.put("/buses/:id", asyncRoute(async (req, res) => { requireRole(req.user, ["admin", "manager", "dispatcher"]); res.json({ bus: await saveBus(req.params.id, req.body, req.user, req) }); }));
app.post("/trips/:id", asyncRoute(async (req, res) => { requireRole(req.user, ["admin", "manager", "dispatcher"]); res.json({ trip: await saveTrip(req.params.id, req.body, req.user, req) }); }));
app.put("/trips/:id", asyncRoute(async (req, res) => { requireRole(req.user, ["admin", "manager", "dispatcher"]); res.json({ trip: await saveTrip(req.params.id, req.body, req.user, req) }); }));
app.post("/trips/:id/transition", asyncRoute(async (req, res) => { requireRole(req.user, ["admin", "manager", "dispatcher"]); res.json({ trip: await transitionTrip(req.params.id, req.body, req.user, req) }); }));
app.post("/crew/:key", asyncRoute(async (req, res) => { requireRole(req.user, ["admin", "manager"]); res.json({ person: await saveCrew(req.params.key, req.body, req.user, req) }); }));
app.put("/crew/:key", asyncRoute(async (req, res) => { requireRole(req.user, ["admin", "manager"]); res.json({ person: await saveCrew(req.params.key, req.body, req.user, req) }); }));

app.get("/shifts/current", asyncRoute(async (req, res) => { requireRole(req.user, ["admin", "manager", "counter"]); res.json({ shift: await fetchCurrentShift(Number(req.user.id)) }); }));
app.post("/shifts/open", asyncRoute(async (req, res) => { requireRole(req.user, ["admin", "manager", "counter"]); res.status(201).json({ shift: await openShift(req.body, req.user, req) }); }));
app.post("/shifts/close", asyncRoute(async (req, res) => { requireRole(req.user, ["admin", "manager", "counter"]); res.status(201).json({ shift: await closeShift(req.body, req.user, req) }); }));

app.get("/expenses", asyncRoute(async (req, res) => {
  requireRole(req.user, ["admin"]);
  if (!financeUnlocked(req)) fail("Enter the administrator password to view finance.", 403, "finance_locked");
  res.json({ expenses: await fetchExpenses() });
}));
app.post("/expenses", asyncRoute(async (req, res) => {
  requireRole(req.user, ["admin"]);
  if (!financeUnlocked(req)) fail("Enter the administrator password to view finance.", 403, "finance_locked");
  res.status(201).json({ expense: await createExpense(req.body, req.user, req) });
}));

app.get("/audit", asyncRoute(async (req, res) => {
  requireRole(req.user, ["admin", "manager"]);
  const [events] = await pool.query("SELECT a.id, a.action, a.entity_type, a.entity_id, a.before_json, a.after_json, a.ip_address, a.created_at, u.name user_name FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id ORDER BY a.id DESC LIMIT 200");
  res.json({ events });
}));
app.post("/users", asyncRoute(async (req, res) => { requireRole(req.user, ["admin"]); res.status(201).json({ user: await createStaffUser(req.body, req.user, req) }); }));

app.use((_req, _res, next) => next(new ApiError("API route not found.", 404, "not_found")));
app.use((error, _req, res, _next) => {
  if (error?.type === "entity.parse.failed") return res.status(400).json({ error: { code: "invalid_json", message: "Request body must be valid JSON." } });
  if (error?.type === "entity.too.large") return res.status(413).json({ error: { code: "request_too_large", message: "Request body is too large." } });
  if (error instanceof ApiError) return res.status(error.status).json({ error: { code: error.code, message: error.message } });
  if (error?.code === "ER_DUP_ENTRY") return res.status(409).json({ error: { code: "duplicate_record", message: "That record conflicts with an existing record." } });
  console.error(error);
  const message = config.env === "production" ? "The server could not complete the request." : error.message;
  return res.status(500).json({ error: { code: "server_error", message } });
});

export { app };
