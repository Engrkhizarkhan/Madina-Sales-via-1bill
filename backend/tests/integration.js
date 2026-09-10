import "dotenv/config";
import bcrypt from "bcryptjs";
import { config } from "../node/config.js";
import { pool, closePool } from "../node/db.js";

const baseUrl = process.env.TEST_API_URL || `http://${config.host}:${config.port}`;
let cookie = "";
let passed = 0;
const createdBookings = [];
let createdExpenseId = null;
let createdExpenseReference = null;
let createdUserId = null;
let testAdminId = null;
let createdRouteId = null;
let createdBusId = null;
let createdTripId = null;
let createdCrewId = null;

const [auditRows] = await pool.query("SELECT COALESCE(MAX(id), 0) id FROM audit_logs");
const initialAuditId = Number(auditRows[0].id);
const testAdminUsername = `node-admin-${Date.now()}`;
const testAdminPassword = "NodeAdmin!2026Test";
const [testAdminResult] = await pool.execute(
  "INSERT INTO users (name, email, username, password_hash, role, force_password_change) VALUES (?, ?, ?, ?, 'admin', 0)",
  ["Automated Node Administrator", `${testAdminUsername}@example.invalid`, testAdminUsername, await bcrypt.hash(testAdminPassword, 12)],
);
testAdminId = Number(testAdminResult.insertId);

const check = (condition, label) => {
  if (!condition) throw new Error(label);
  passed++;
  console.log(`PASS  ${label}`);
};

async function request(method, path, body, csrf, useCookie = true) {
  const headers = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (csrf) headers["X-CSRF-Token"] = csrf;
  if (cookie && useCookie) headers.Cookie = cookie;
  const response = await fetch(`${baseUrl}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const setCookie = response.headers.get("set-cookie");
  if (setCookie && useCookie) cookie = setCookie.split(";")[0];
  const payload = await response.json();
  return { status: response.status, body: payload };
}

function nextServiceDate(days) {
  const date = new Date();
  for (let index = 0; index < 14; index++) {
    date.setUTCDate(date.getUTCDate() + 1);
    const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][date.getUTCDay()];
    if (days.includes(day)) return date.toISOString().slice(0, 10);
  }
  throw new Error("No service date found.");
}

try {
  const health = await request("GET", "/health");
  check(health.status === 200 && health.body.database === "connected" && health.body.runtime === "node", "Node.js health endpoint and MySQL connection");
  check((await request("GET", "/admin/bootstrap")).status === 401, "admin data rejects anonymous access");
  const publicResult = await request("GET", "/public/bootstrap");
  check(publicResult.status === 404 && publicResult.body.error.code === "public_site_disabled", "public website remains disabled until 1Bill is configured");
  check((await request("POST", "/auth/login", { identity: "not-a-user", password: "wrong" })).status === 401, "invalid staff login is rejected");

  const login = await request("POST", "/auth/login", { identity: testAdminUsername, password: testAdminPassword });
  check(login.status === 200 && login.body.csrfToken, "Node.js login creates a MySQL-backed session");
  const csrf = login.body.csrfToken;
  const bootstrap = await request("GET", "/admin/bootstrap");
  check(bootstrap.status === 200 && bootstrap.body.routes.length > 0, "authenticated operations data loads");
  const trip = bootstrap.body.trips[0];
  const bus = bootstrap.body.fleet.find((item) => item.id === trip.busId);
  const date = nextServiceDate(trip.days);
  const occupied = bootstrap.body.bookings
    .filter((item) => item.tripId === trip.id && item.date === date && ["Confirmed", "Reserved"].includes(item.bookingStatus))
    .flatMap((item) => item.seats);
  const seat = Array.from({ length: bus.seats }, (_, index) => bus.seats - index).find((number) => !occupied.includes(number));
  if (!seat) throw new Error("No free seat is available for the integration test.");
  const bookingRequest = { passenger: "Automated Node QA Passenger", phone: "03001234567", cnic: "17301-1234567-1", gender: "Male", tripId: trip.id, date, seats: [seat] };
  const created = await request("POST", "/bookings", { ...bookingRequest, bookingStatus: "Confirmed", paymentMethod: "Cash", discount: 0 }, csrf);
  check(created.status === 201 && created.body.booking.paymentStatus === "Paid", "counter POS starts selling immediately without a shift");
  const booking = created.body.booking;
  createdBookings.push(booking.id);
  check((await request("POST", "/bookings", { ...bookingRequest, bookingStatus: "Confirmed", paymentMethod: "Cash", discount: 0 }, csrf)).status === 409, "database prevents duplicate trip seats");
  const csrfFailure = await request("POST", `/bookings/${booking.id}/refunds`, { amount: 1, method: "Cash", reason: "Other" });
  check(csrfFailure.status === 403 && csrfFailure.body.error.code === "csrf_failed", "authenticated state changes require CSRF");
  check((await request("POST", `/bookings/${booking.id}/refunds`, { amount: 1, method: "Cash", reason: "Other" }, undefined, false)).status === 401, "anonymous state changes are rejected");

  const partial = Math.round(booking.paid * 50) / 100;
  const partialRefund = await request("POST", `/bookings/${booking.id}/refunds`, { amount: partial, method: "Cash", reason: "Passenger request", reference: `NODE-PART-${Date.now()}`, notes: "Node integration" }, csrf);
  check(partialRefund.status === 201 && partialRefund.body.booking.paymentStatus === "Partially refunded", "partial refund is persisted");
  check((await request("POST", `/bookings/${booking.id}/refunds`, { amount: booking.paid + 1, method: "Cash", reason: "Other" }, csrf)).status === 422, "refund cannot exceed remaining payment");
  const fullRefund = await request("POST", `/bookings/${booking.id}/refunds`, { amount: partial, method: "Cash", reason: "Passenger request", reference: `NODE-FINAL-${Date.now()}` }, csrf);
  check(fullRefund.status === 201 && fullRefund.body.booking.bookingStatus === "Refunded", "complete cumulative refund closes booking");

  const reservation = await request("POST", "/bookings", { ...bookingRequest, bookingStatus: "Reserved", paymentMethod: "Cash", discount: 0 }, csrf);
  check(reservation.status === 201 && reservation.body.booking.bookingStatus === "Reserved", "refunded seat can be reserved again");
  createdBookings.push(reservation.body.booking.id);
  const confirmed = await request("POST", `/bookings/${reservation.body.booking.id}/confirm`, { paymentMethod: "Cash" }, csrf);
  check(confirmed.status === 200 && confirmed.body.booking.bookingStatus === "Confirmed", "reservation payment creates a confirmed ticket");

  const locked = await request("GET", "/expenses");
  check(locked.status === 403 && locked.body.error.code === "finance_locked", "finance remains locked by default");
  check((await request("POST", "/auth/finance-unlock", { password: "wrong-password" }, csrf)).status === 422, "wrong finance password is rejected");
  const unlocked = await request("POST", "/auth/finance-unlock", { password: testAdminPassword }, csrf);
  check(unlocked.status === 200 && unlocked.body.unlocked, "administrator password unlocks finance");

  createdExpenseReference = `NODE-EXP-${Date.now()}`;
  const expense = await request("POST", "/expenses", { date: new Date().toISOString().slice(0, 10), category: "Terminal", description: "Automated Node expense", amount: 100, paymentMethod: "Cash", reference: createdExpenseReference, notes: "Cleanup expected" }, csrf);
  if (expense.status !== 201 || Number(expense.body.expense?.amount) !== 100) {
    throw new Error(`Node.js records audited expenses (${expense.status}: ${expense.body.error?.code || "unexpected response"})`);
  }
  check(true, "Node.js records audited expenses");
  createdExpenseId = Number(expense.body.expense.id);
  check((await request("GET", "/expenses")).status === 200, "unlocked expense history loads");
  check((await request("POST", "/shifts/open", { counterName: "Old flow", openingCash: 0 }, csrf)).status === 404, "shift endpoints are removed");

  createdRouteId = `qa-route-${Date.now()}`;
  const routeResult = await request("POST", "/routes/new", { id: createdRouteId, from: "QA City", to: "Test City", distance: "10 km", duration: "20m", fare: 500, boarding: "QA Terminal", status: "Active" }, csrf);
  createdRouteId = routeResult.body.route.id;
  check(routeResult.status === 200, "route can be added");
  createdBusId = `qa-bus-${Date.now()}`;
  const busResult = await request("POST", "/buses/new", { id: createdBusId, registration: `QA-${String(Date.now()).slice(-6)}`, service: "Executive", seats: 35, model: "QA Model", year: 2026, status: "Ready", nextService: "Not scheduled" }, csrf);
  createdBusId = busResult.body.bus.id;
  check(busResult.status === 200, "bus can be added");
  const tripResult = await request("POST", "/trips/new", { routeId: createdRouteId, busId: createdBusId, departure: "23:50", arrival: "00:20", driver: "QA Driver", attendant: "QA Attendant", platform: "QA-1", status: "Scheduled", days: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"], active: true, runNumber: 1 }, csrf);
  createdTripId = tripResult.body.trip.id;
  check(tripResult.status === 200, "trip can be added");
  check((await request("DELETE", `/routes/${createdRouteId}`, undefined, csrf)).status === 409, "route deletion protects assigned trips");
  check((await request("DELETE", `/buses/${createdBusId}`, undefined, csrf)).status === 409, "bus deletion protects assigned trips");
  check((await request("DELETE", `/trips/${createdTripId}`, undefined, csrf)).status === 200, "unused trip can be deleted");
  createdTripId = null;
  check((await request("DELETE", `/buses/${createdBusId}`, undefined, csrf)).status === 200, "unused bus can be deleted");
  createdBusId = null;
  check((await request("DELETE", `/routes/${createdRouteId}`, undefined, csrf)).status === 200, "unused route can be deleted");
  createdRouteId = null;
  const crewResult = await request("POST", "/crew/new", { name: "Automated Spare Crew", role: "Driver", phone: "03009999999", cnic: `${String(Date.now()).slice(-5)}-1234567-1`, license: "QA-HTV", duty: "Available", status: "Available", initials: "AC" }, csrf);
  createdCrewId = Number(crewResult.body.person.id);
  check(crewResult.status === 200, "crew member can be added");
  check((await request("DELETE", `/crew/${createdCrewId}`, undefined, csrf)).status === 200, "unassigned crew member can be deleted");
  createdCrewId = null;
  check((await request("GET", "/audit")).body.events.length >= 5, "audit trail records sensitive operations");

  const qaUsername = `node-counter-${Date.now()}`;
  const qaPassword = "NodeCounter!2026";
  const staff = await request("POST", "/users", { name: "Automated Node Counter", email: `${qaUsername}@example.invalid`, username: qaUsername, role: "counter", password: qaPassword }, csrf);
  check(staff.status === 201 && staff.body.user.role === "counter", "administrator creates a scoped staff user");
  createdUserId = Number(staff.body.user.id);
  await pool.execute("UPDATE users SET force_password_change = 0 WHERE id = ?", [createdUserId]);
  check((await request("POST", "/auth/logout", {}, csrf)).status === 200, "logout invalidates Node.js session");
  cookie = "";
  check((await request("GET", "/admin/bootstrap")).status === 401, "logged-out session cannot access operations");

  const counterLogin = await request("POST", "/auth/login", { identity: qaUsername, password: qaPassword });
  check(counterLogin.status === 200, "new staff account authenticates through Node.js");
  const counterCsrf = counterLogin.body.csrfToken;
  const counterBootstrap = await request("GET", "/admin/bootstrap");
  check(counterBootstrap.status === 200 && counterBootstrap.body.users.length === 0, "staff cannot retrieve user administration records");
  check((await request("GET", "/finance/status")).status === 403, "staff cannot view finance");
  check((await request("POST", "/auth/finance-unlock", { password: qaPassword }, counterCsrf)).status === 403, "staff cannot unlock finance");
  check((await request("POST", `/bookings/${booking.id}/refunds`, { amount: 1, method: "Cash", reason: "Other" }, counterCsrf)).status === 403, "counter role cannot issue refunds");
  await request("POST", "/auth/logout", {}, counterCsrf);

  console.log(`\n${passed} Node.js integration checks passed.`);
} finally {
  try {
    if (createdExpenseId) {
      await pool.execute("DELETE FROM audit_logs WHERE entity_type = 'expense' AND entity_id = ?", [String(createdExpenseId)]);
      if (createdExpenseReference) await pool.execute("DELETE FROM financial_transactions WHERE transaction_type = 'expense' AND reference = ?", [createdExpenseReference]);
      await pool.execute("DELETE FROM expenses WHERE id = ?", [createdExpenseId]);
    }
    if (createdCrewId) await pool.execute("DELETE FROM crew WHERE id = ?", [createdCrewId]);
    if (createdTripId) await pool.execute("DELETE FROM trips WHERE id = ?", [createdTripId]);
    if (createdBusId) await pool.execute("DELETE FROM buses WHERE id = ?", [createdBusId]);
    if (createdRouteId) await pool.execute("DELETE FROM routes WHERE id = ?", [createdRouteId]);
    if (createdBookings.length) {
      await pool.query("DELETE FROM audit_logs WHERE entity_type = 'booking' AND entity_id IN (?)", [createdBookings]);
      await pool.query("DELETE FROM financial_transactions WHERE booking_id IN (?)", [createdBookings]);
      await pool.query("DELETE FROM refunds WHERE booking_id IN (?)", [createdBookings]);
      await pool.query("DELETE FROM booking_seats WHERE booking_id IN (?)", [createdBookings]);
      await pool.query("DELETE FROM bookings WHERE id IN (?)", [createdBookings]);
    }
    await pool.execute("DELETE FROM audit_logs WHERE id > ?", [initialAuditId]);
    if (createdUserId) {
      await pool.execute("DELETE FROM api_sessions WHERE user_id = ?", [createdUserId]);
      await pool.execute("DELETE FROM users WHERE id = ?", [createdUserId]);
    }
    if (testAdminId) {
      await pool.execute("DELETE FROM api_sessions WHERE user_id = ?", [testAdminId]);
      await pool.execute("DELETE FROM users WHERE id = ?", [testAdminId]);
    }
  } finally {
    await closePool();
  }
}
