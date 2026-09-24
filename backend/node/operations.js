import bcrypt from "bcryptjs";
import { config } from "./config.js";
import { pool, transaction } from "./db.js";
import { allowed, decimal, fail, isoDateTime, pakistanDate, parseJson, requireFields, sqlDateTime, trimTime, uuid } from "./helpers.js";
import { fetchBooking, fetchBuses, fetchCrew, fetchExpenses, fetchRoutes, fetchTripRuns, fetchTrips, fetchUsers } from "./repository.js";

const query = async (executor, sql, parameters = []) => {
  const [result] = await executor.execute(sql, parameters);
  return result;
};

export async function audit(action, entityType, entityId, before, after, userId, req, executor = pool) {
  await query(executor,
    "INSERT INTO audit_logs (user_id, action, entity_type, entity_id, before_json, after_json, ip_address) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [userId || null, action, entityType, String(entityId), before == null ? null : JSON.stringify(before),
      after == null ? null : JSON.stringify(after), String(req?.ip || "system").slice(0, 64)],
  );
}

const validDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value)) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
const weekday = (date) => ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][new Date(`${date}T00:00:00Z`).getUTCDay()];
const timeCode = () => sqlDateTime().slice(11).replaceAll(":", "");

export async function createBooking(data, user, isPublic, req) {
  requireFields(data, ["passenger", "phone", "cnic", "gender", "tripId", "date", "seats"]);
  const seats = [...new Set(Array.isArray(data.seats) ? data.seats.map(Number).filter(Number.isInteger) : [])];
  if (!seats.length) fail("Select at least one seat.", 422, "validation_error");
  if (isPublic && seats.length > 4) fail("Online bookings are limited to four seats.", 422, "validation_error");
  for (const [field, maximum] of [["passenger", 160], ["phone", 30], ["cnic", 50]]) {
    if (String(data[field]).trim().length > maximum) fail(`${field} is too long.`, 422, "validation_error");
  }
  return transaction(async (connection) => {
    const trips = await query(connection,
      `SELECT t.*, r.origin, r.destination, r.fare route_fare, r.boarding_point, r.status route_status,
              b.registration, b.service, b.seats capacity, b.status bus_status
       FROM trips t JOIN routes r ON r.id = t.route_id JOIN buses b ON b.id = t.bus_id
       WHERE t.id = ? FOR UPDATE`, [String(data.tripId)]);
    const trip = trips[0];
    if (!trip || !trip.active || trip.route_status !== "Active" || ["Maintenance", "Retired"].includes(trip.bus_status)) {
      fail("This departure is not available for booking.", 409, "departure_unavailable");
    }
    const travelDate = String(data.date);
    if (!validDate(travelDate) || (isPublic && travelDate < pakistanDate())) fail("Choose a valid travel date.", 422, "validation_error");
    const departure = trimTime(trip.departure);
    if (new Date(`${travelDate}T${departure}:00+05:00`) <= new Date()) fail("This departure time has already passed.", 409, "departure_unavailable");
    if (!parseJson(trip.service_days).includes(weekday(travelDate))) fail("This trip does not run on the selected date.", 409, "departure_unavailable");
    const tripRunId = `${trip.id}-${travelDate}-run-1`;
    await query(connection,
      `INSERT IGNORE INTO trip_runs
       (id, trip_id, service_date, run_number, bus_id, driver, attendant, platform, status, notes)
       VALUES (?, ?, ?, 1, ?, ?, ?, ?, 'Scheduled', '')`,
      [tripRunId, trip.id, travelDate, trip.bus_id, trip.driver, trip.attendant, trip.platform]);
    const runs = await query(connection,
      `SELECT tr.*, b.registration, b.service, b.seats capacity, b.status bus_status
       FROM trip_runs tr JOIN buses b ON b.id = tr.bus_id
       WHERE tr.id = ? FOR UPDATE`, [tripRunId]);
    const run = runs[0];
    if (!run || ["Departed", "Cancelled"].includes(run.status) || ["Maintenance", "Retired"].includes(run.bus_status)) {
      fail("This dated departure is not available for booking.", 409, "departure_unavailable");
    }
    if (seats.some((seat) => seat < 1 || seat > Number(run.capacity))) fail("One or more selected seats are invalid.", 422, "validation_error");
    const reserved = isPublic || data.bookingStatus === "Reserved";
    const paymentMethod = isPublic ? "Cash" : String(data.paymentMethod || "Cash");
    allowed(paymentMethod, ["Cash", "Card", "Bank transfer", "1Bill"], "paymentMethod");
    if (paymentMethod === "1Bill" && config.paymentMode === "disabled") fail("1Bill is not active yet. Choose cash or card.", 409, "payment_unavailable");
    let paymentReference = isPublic ? "" : String(data.paymentReference || "").trim();
    if (!reserved && paymentMethod !== "Cash" && !paymentReference) fail("A verified payment reference is required.", 422, "validation_error");
    paymentReference ||= `CASH-${timeCode()}`;
    const fare = Number(trip.route_fare);
    const discount = isPublic ? 0 : Math.min(decimal(data.discount ?? 0, "discount"), fare * seats.length);
    const total = Math.round((fare * seats.length - discount) * 100) / 100;
    const paid = reserved ? 0 : total;
    const id = uuid("booking-");
    const stamp = sqlDateTime().replace(/[-: ]/g, "").slice(2);
    const ticketNo = `${reserved ? "RS" : "ME"}-${stamp}-${uuid().slice(-6).toUpperCase()}`;
    const expiresAt = reserved ? sqlDateTime(new Date(Date.now() + 7_200_000)) : null;
    await query(connection,
      `INSERT INTO bookings
       (id, ticket_no, source, passenger, phone, cnic, gender, route_label, destination, boarding_point,
        bus_registration, service, fare, discount, total, paid, balance, payment_method, payment_reference,
        payment_status, booking_status, travel_date, travel_time, driver, attendant, trip_id, trip_run_id,
        expires_at, seat_printed_at, issued_by, terminal, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, ticketNo, isPublic ? "Public web" : "Counter", String(data.passenger).trim(), String(data.phone).trim(),
        String(data.cnic).trim(), ["Male", "Female"].includes(data.gender) ? data.gender : "Male",
        `${trip.origin} → ${trip.destination}`, trip.destination, String(data.boardingPoint || trip.boarding_point).trim(),
        run.registration, run.service, fare, discount, total, paid, reserved ? total : 0, paymentMethod, paymentReference,
        reserved ? "Unpaid" : "Paid", reserved ? "Reserved" : "Confirmed", travelDate, trip.departure, run.driver,
        run.attendant, trip.id, tripRunId, expiresAt, reserved ? null : sqlDateTime(), user?.name || "Public website",
        "Madina Terminal, Peshawar", user?.id || null]);
    for (const seat of seats) {
      await query(connection, "INSERT INTO booking_seats (booking_id, trip_run_id, seat_number, active) VALUES (?, ?, ?, 1)", [id, tripRunId, seat]);
    }
    if (!reserved) {
      await query(connection,
        "INSERT INTO financial_transactions (booking_id, transaction_type, amount, payment_method, reference, description, created_by) VALUES (?, 'sale', ?, ?, ?, ?, ?)",
        [id, paid, paymentMethod, paymentReference, `Ticket ${ticketNo}`, user?.id || null]);
    }
    const created = await fetchBooking(id, connection);
    await audit("booking.created", "booking", id, null, created, user?.id, req, connection);
    return created;
  });
}

export async function updateBooking(id, data, user, req) {
  const before = await fetchBooking(id);
  if (!before) fail("Booking not found.", 404, "not_found");
  if (["Refunded", "Cancelled"].includes(before.bookingStatus)) fail("Closed bookings cannot be edited.", 409, "booking_closed");
  requireFields(data, ["passenger", "phone", "cnic", "gender", "destination", "boardingPoint"]);
  await query(pool, "UPDATE bookings SET passenger = ?, phone = ?, cnic = ?, gender = ?, destination = ?, boarding_point = ? WHERE id = ?",
    [String(data.passenger).trim(), String(data.phone).trim(), String(data.cnic).trim(),
      ["Male", "Female"].includes(data.gender) ? data.gender : "Male", String(data.destination).trim(), String(data.boardingPoint).trim(), id]);
  const after = await fetchBooking(id);
  await audit("booking.updated", "booking", id, before, after, user.id, req);
  return after;
}

export async function cancelBooking(id, user, req) {
  return transaction(async (connection) => {
    const before = await fetchBooking(id, connection);
    if (!before) fail("Booking not found.", 404, "not_found");
    if (before.paid > 0) fail("Paid bookings must be refunded instead of cancelled.", 409, "refund_required");
    await query(connection, "UPDATE bookings SET booking_status = 'Cancelled' WHERE id = ?", [id]);
    await query(connection, "UPDATE booking_seats SET active = 0 WHERE booking_id = ?", [id]);
    const after = await fetchBooking(id, connection);
    await audit("booking.cancelled", "booking", id, before, after, user.id, req, connection);
    return after;
  });
}

export async function confirmReservation(id, data, user, req) {
  return transaction(async (connection) => {
    const records = await query(
      connection,
      "SELECT *, (expires_at IS NOT NULL AND expires_at <= NOW()) is_expired FROM bookings WHERE id = ? FOR UPDATE",
      [id],
    );
    const row = records[0];
    if (!row || row.booking_status !== "Reserved") fail("Active reservation not found.", 404, "not_found");
    if (row.is_expired) fail("This reservation has expired.", 409, "reservation_expired");
    const method = allowed(String(data.paymentMethod || "Cash"), ["Cash", "Card", "Bank transfer", "1Bill"], "paymentMethod");
    if (method === "1Bill" && config.paymentMode === "disabled") fail("1Bill is not active yet. Choose cash or card.", 409, "payment_unavailable");
    let reference = String(data.paymentReference || "").trim();
    if (method !== "Cash" && !reference) fail("A verified payment reference is required.", 422, "validation_error");
    reference ||= `CASH-${timeCode()}`;
    const ticketNo = row.ticket_no.replace(/^RS-/, "ME-");
    const before = await fetchBooking(id, connection);
    await query(connection,
      "UPDATE bookings SET ticket_no = ?, paid = total, balance = 0, payment_method = ?, payment_reference = ?, payment_status = 'Paid', booking_status = 'Confirmed', expires_at = NULL, seat_printed_at = NOW(), issued_by = ? WHERE id = ?",
      [ticketNo, method, reference, user.name, id]);
    await query(connection,
      "INSERT INTO financial_transactions (booking_id, transaction_type, amount, payment_method, reference, description, created_by) VALUES (?, 'sale', ?, ?, ?, ?, ?)",
      [id, Number(row.total), method, reference, `Confirmed reservation ${ticketNo}`, user.id]);
    const after = await fetchBooking(id, connection);
    await audit("reservation.confirmed", "booking", id, before, after, user.id, req, connection);
    return after;
  });
}

export async function refundBooking(id, data, user, req) {
  requireFields(data, ["amount", "method", "reason"]);
  return transaction(async (connection) => {
    const records = await query(connection, "SELECT * FROM bookings WHERE id = ? FOR UPDATE", [id]);
    const row = records[0];
    if (!row || Number(row.paid) <= 0) fail("Paid booking not found.", 404, "not_found");
    const sums = await query(connection, "SELECT COALESCE(SUM(amount), 0) total FROM refunds WHERE booking_id = ?", [id]);
    const remaining = Math.round((Number(row.paid) - Number(sums[0].total)) * 100) / 100;
    const amount = decimal(data.amount, "amount", 0.01);
    if (amount > remaining) fail("Refund amount exceeds the remaining paid balance.", 422, "refund_too_large");
    const method = allowed(String(data.method), ["Cash", "Card", "Bank transfer", "1Bill"], "method");
    const reason = allowed(String(data.reason), ["Passenger request", "Trip cancelled", "Duplicate payment", "Service disruption", "Other"], "reason");
    let reference = String(data.reference || "").trim();
    if (method !== "Cash" && !reference) fail("A refund reference is required for non-cash refunds.", 422, "validation_error");
    reference ||= `CASH-${timeCode()}`;
    const refundId = uuid("refund-");
    const before = await fetchBooking(id, connection);
    await query(connection, "INSERT INTO refunds (id, booking_id, amount, method, reason, reference, notes, processed_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [refundId, id, amount, method, reason, reference, String(data.notes || "").trim(), user.id]);
    const full = Math.abs(amount - remaining) < 0.001;
    await query(connection, "UPDATE bookings SET payment_status = ?, booking_status = ? WHERE id = ?",
      [full ? "Refunded" : "Partially refunded", full ? "Refunded" : row.booking_status, id]);
    if (full) await query(connection, "UPDATE booking_seats SET active = 0 WHERE booking_id = ?", [id]);
    await query(connection,
      "INSERT INTO financial_transactions (booking_id, refund_id, transaction_type, amount, payment_method, reference, description, created_by) VALUES (?, ?, 'refund', ?, ?, ?, ?, ?)",
      [id, refundId, -amount, method, reference, `Refund: ${reason}`, user.id]);
    const after = await fetchBooking(id, connection);
    await audit("booking.refunded", "booking", id, before, after, user.id, req, connection);
    return after;
  });
}

export async function saveRoute(id, data, user, req) {
  requireFields(data, ["from", "to", "distance", "duration", "fare", "boarding", "status"]);
  const recordId = id === "new" ? uuid("route-") : id;
  const before = (await fetchRoutes()).find((item) => item.id === recordId) || null;
  await query(pool,
    `INSERT INTO routes (id, origin, destination, distance, duration, fare, boarding_point, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE origin = VALUES(origin), destination = VALUES(destination), distance = VALUES(distance),
       duration = VALUES(duration), fare = VALUES(fare), boarding_point = VALUES(boarding_point), status = VALUES(status)`,
    [recordId, String(data.from).trim(), String(data.to).trim(), String(data.distance).trim(), String(data.duration).trim(),
      decimal(data.fare, "fare"), String(data.boarding).trim(), data.status === "Paused" ? "Paused" : "Active"]);
  const after = (await fetchRoutes()).find((item) => item.id === recordId);
  await audit(before ? "route.updated" : "route.created", "route", recordId, before, after, user.id, req);
  return after;
}

export async function saveBus(id, data, user, req) {
  requireFields(data, ["registration", "service", "seats", "model", "year", "status", "nextService"]);
  const recordId = id === "new" ? String(data.registration).trim().toLowerCase().replace(/[^a-z0-9]+/g, "-") : id;
  const before = (await fetchBuses()).find((item) => item.id === recordId) || null;
  await query(pool,
    `INSERT INTO buses (id, registration, service, seats, model, model_year, status, next_service) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE registration = VALUES(registration), service = VALUES(service), seats = VALUES(seats),
       model = VALUES(model), model_year = VALUES(model_year), status = VALUES(status), next_service = VALUES(next_service)`,
    [recordId, String(data.registration).trim().toUpperCase(), String(data.service).trim(), Number(data.seats),
      String(data.model).trim(), Number(data.year), data.status, String(data.nextService).trim()]);
  const after = (await fetchBuses()).find((item) => item.id === recordId);
  await audit(before ? "bus.updated" : "bus.created", "bus", recordId, before, after, user.id, req);
  return after;
}

export async function saveTrip(id, data, user, req) {
  requireFields(data, ["routeId", "busId", "departure", "arrival", "driver", "attendant", "platform", "status", "days"]);
  const recordId = id === "new" ? uuid("trip-") : id;
  const days = Array.isArray(data.days) ? data.days.filter((day) => ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].includes(day)) : [];
  if (!days.length) fail("Select at least one service day.", 422, "validation_error");
  const conflicts = (await fetchTrips()).filter((trip) =>
    trip.id !== recordId && trip.active && data.active &&
    trip.departure === String(data.departure).slice(0, 5) &&
    trip.days.some((day) => days.includes(day)) &&
    (trip.busId === data.busId || trip.driver === String(data.driver).trim() || trip.attendant === String(data.attendant).trim()),
  );
  if (conflicts.length) {
    fail("This bus or crew member already has a trip at the same time on one of the selected days.", 409, "roster_conflict");
  }
  const before = (await fetchTrips()).find((item) => item.id === recordId) || null;
  const lastDepartedAt = data.lastDepartedAt ? sqlDateTime(new Date(data.lastDepartedAt)) : null;
  await query(pool,
    `INSERT INTO trips (id, route_id, bus_id, departure, arrival, driver, attendant, platform, status, service_days, active, run_number, last_departed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE route_id = VALUES(route_id), bus_id = VALUES(bus_id), departure = VALUES(departure),
       arrival = VALUES(arrival), driver = VALUES(driver), attendant = VALUES(attendant), platform = VALUES(platform),
       status = VALUES(status), service_days = VALUES(service_days), active = VALUES(active),
       run_number = VALUES(run_number), last_departed_at = VALUES(last_departed_at)`,
    [recordId, data.routeId, data.busId, data.departure, data.arrival, String(data.driver).trim(),
      String(data.attendant).trim(), String(data.platform).trim(), data.status, JSON.stringify(days), data.active ? 1 : 0,
      Number(data.runNumber || 1), lastDepartedAt]);
  const after = (await fetchTrips()).find((item) => item.id === recordId);
  await audit(before ? "trip.updated" : "trip.created", "trip", recordId, before, after, user.id, req);
  return after;
}

export async function saveCrew(key, data, user, req) {
  requireFields(data, ["name", "role", "phone", "cnic", "license", "duty", "status", "initials"]);
  const previous = key === "new" ? [] : await query(pool, "SELECT * FROM crew WHERE name = ? LIMIT 1", [key]);
  const before = previous[0] || null;
  let id;
  if (before) {
    await query(pool, "UPDATE crew SET name = ?, role = ?, phone = ?, cnic = ?, license = ?, duty = ?, status = ?, initials = ? WHERE id = ?",
      [String(data.name).trim(), data.role, String(data.phone).trim(), String(data.cnic).trim(), String(data.license).trim(),
        String(data.duty).trim(), data.status, String(data.initials).trim().toUpperCase(), before.id]);
    id = Number(before.id);
  } else {
    const result = await query(pool, "INSERT INTO crew (name, role, phone, cnic, license, duty, status, initials) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [String(data.name).trim(), data.role, String(data.phone).trim(), String(data.cnic).trim(), String(data.license).trim(),
        String(data.duty).trim(), data.status, String(data.initials).trim().toUpperCase()]);
    id = Number(result.insertId);
  }
  const after = (await fetchCrew()).find((item) => item.id === id);
  await audit(before ? "crew.updated" : "crew.created", "crew", id, before, after, user.id, req);
  return after;
}

export async function deleteRoute(id, user, req) {
  const before = (await fetchRoutes()).find((item) => item.id === id);
  if (!before) fail("Route not found.", 404, "not_found");
  const references = await query(pool, "SELECT COUNT(*) count FROM trips WHERE route_id = ?", [id]);
  if (Number(references[0].count) > 0) {
    fail("This route is used by a trip. Delete or reassign that trip first, or pause the route.", 409, "record_in_use");
  }
  await query(pool, "DELETE FROM routes WHERE id = ?", [id]);
  await audit("route.deleted", "route", id, before, null, user.id, req);
}

export async function deleteBus(id, user, req) {
  const before = (await fetchBuses()).find((item) => item.id === id);
  if (!before) fail("Bus not found.", 404, "not_found");
  const references = await query(pool, "SELECT COUNT(*) count FROM trips WHERE bus_id = ?", [id]);
  if (Number(references[0].count) > 0) {
    fail("This bus is assigned to a trip. Delete or reassign that trip first, or mark the bus as retired.", 409, "record_in_use");
  }
  await query(pool, "DELETE FROM buses WHERE id = ?", [id]);
  await audit("bus.deleted", "bus", id, before, null, user.id, req);
}

export async function deleteTrip(id, user, req) {
  const before = (await fetchTrips()).find((item) => item.id === id);
  if (!before) fail("Trip not found.", 404, "not_found");
  const references = await query(pool, "SELECT COUNT(*) count FROM bookings WHERE trip_id = ?", [id]);
  if (Number(references[0].count) > 0) {
    fail("This trip has ticket history and cannot be deleted. Pause the schedule instead.", 409, "record_in_use");
  }
  await query(pool, "DELETE FROM trip_runs WHERE trip_id = ?", [id]);
  await query(pool, "DELETE FROM trips WHERE id = ?", [id]);
  await audit("trip.deleted", "trip", id, before, null, user.id, req);
}

export async function deleteCrew(id, user, req) {
  const records = await query(pool, "SELECT * FROM crew WHERE id = ? LIMIT 1", [id]);
  const before = records[0];
  if (!before) fail("Staff member not found.", 404, "not_found");
  const activeAssignments = await query(
    pool,
    "SELECT COUNT(*) count FROM trips WHERE active = 1 AND (driver = ? OR attendant = ?)",
    [before.name, before.name],
  );
  if (Number(activeAssignments[0].count) > 0) {
    fail("This staff member is assigned to an active trip. Reassign or pause that trip first.", 409, "record_in_use");
  }
  await query(pool, "DELETE FROM crew WHERE id = ?", [id]);
  await audit("crew.deleted", "crew", id, before, null, user.id, req);
}

export async function transitionTrip(id, data, user, req) {
  requireFields(data, ["action", "date"]);
  const action = allowed(data.action, ["boarding", "depart", "next"], "action");
  const serviceDate = String(data.date);
  if (!validDate(serviceDate)) fail("Choose a valid service date.", 422, "validation_error");
  return transaction(async (connection) => {
    const before = (await fetchTrips(false, connection)).find((item) => item.id === id);
    if (!before) fail("Trip not found.", 404, "not_found");
    const runId = `${id}-${serviceDate}-run-1`;
    await query(connection,
      `INSERT IGNORE INTO trip_runs
       (id, trip_id, service_date, run_number, bus_id, driver, attendant, platform, status, notes)
       VALUES (?, ?, ?, 1, ?, ?, ?, ?, 'Scheduled', '')`,
      [runId, id, serviceDate, before.busId, before.driver, before.attendant, before.platform]);
    if (action === "boarding") await query(connection, "UPDATE trip_runs SET status = 'Boarding', boarding_started_at = NOW() WHERE id = ?", [runId]);
    if (action === "depart") {
      await query(connection, "UPDATE trip_runs SET status = 'Departed', departed_at = NOW() WHERE id = ?", [runId]);
      await query(connection, "UPDATE trips SET last_departed_at = NOW() WHERE id = ?", [id]);
      await query(connection, "UPDATE buses SET status = 'On route' WHERE id = ?", [before.busId]);
    }
    if (action === "next") await query(connection, "UPDATE trip_runs SET status = 'Scheduled', boarding_started_at = NULL, departed_at = NULL WHERE id = ?", [runId]);
    const run = (await fetchTripRuns(serviceDate, connection)).find((item) => item.tripId === id);
    const after = { ...before, status: run.status, runNumber: run.runNumber, runDate: serviceDate };
    await audit(`trip.${action}`, "trip_run", runId, before, after, user.id, req, connection);
    return after;
  });
}

export async function createExpense(data, user, req) {
  requireFields(data, ["date", "category", "description", "amount", "paymentMethod"]);
  const amount = decimal(data.amount, "amount", 0.01);
  const category = allowed(String(data.category), ["Terminal", "Fuel", "Maintenance", "Driver advance", "Refreshment", "Utilities", "Salary", "Other"], "category");
  const method = allowed(String(data.paymentMethod), ["Cash", "Card", "Bank transfer"], "paymentMethod");
  if (!validDate(data.date)) fail("Choose a valid expense date.", 422, "validation_error");
  const description = String(data.description).trim();
  if (description.length > 255) fail("Expense description is too long.", 422, "validation_error");
  const reference = String(data.reference || "").trim();
  if (method !== "Cash" && !reference) fail("A payment reference is required for non-cash expenses.", 422, "validation_error");
  return transaction(async (connection) => {
    const result = await query(connection,
      "INSERT INTO expenses (expense_date, category, description, amount, payment_method, reference, notes, shift_id, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [data.date, category, description, amount, method, reference, String(data.notes || "").trim(), null, user.id]);
    const ledgerReference = reference || `EXPENSE-${result.insertId}`;
    await query(connection,
      "INSERT INTO financial_transactions (transaction_type, amount, payment_method, reference, description, created_by) VALUES ('expense', ?, ?, ?, ?, ?)",
      [-amount, method, ledgerReference, `${category}: ${description}`, user.id]);
    const expense = (await fetchExpenses(connection)).find((item) => item.id === Number(result.insertId));
    await audit("expense.created", "expense", result.insertId, null, expense, user.id, req, connection);
    return expense;
  });
}

export async function createStaffUser(data, user, req) {
  requireFields(data, ["name", "email", "username", "role", "password"]);
  const role = allowed(String(data.role), ["admin", "manager", "counter", "dispatcher", "finance"], "role");
  const email = String(data.email).trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail("Enter a valid email address.", 422, "validation_error");
  const username = String(data.username).trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,40}$/.test(username)) {
    fail("Username must be 3-40 characters using letters, numbers, dots, dashes or underscores.", 422, "validation_error");
  }
  const password = String(data.password);
  if (password.length < 12 || !/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/\d/.test(password) || !/[^A-Za-z0-9]/.test(password)) {
    fail("Use at least 12 characters with upper-case, lower-case, number and symbol.", 422, "weak_password");
  }
  const result = await query(pool,
    "INSERT INTO users (name, email, username, password_hash, role, force_password_change) VALUES (?, ?, ?, ?, ?, 1)",
    [String(data.name).trim(), email, username, await bcrypt.hash(password, 12), role]);
  const created = (await fetchUsers()).find((item) => item.id === Number(result.insertId));
  await audit("user.created", "user", result.insertId, null, created, user.id, req);
  return created;
}
