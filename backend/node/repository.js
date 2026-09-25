import { pool } from "./db.js";
import { isoDateTime, parseJson, trimTime } from "./helpers.js";

const rows = async (sql, parameters = [], executor = pool) => {
  const [result] = await executor.execute(sql, parameters);
  return result;
};

export async function fetchRoutes(activeOnly = false, executor = pool) {
  const result = await rows(
    `SELECT id, origin, destination, distance, duration, fare, boarding_point, status
     FROM routes ${activeOnly ? "WHERE status = 'Active'" : ""} ORDER BY origin, destination`,
    [], executor,
  );
  return result.map((row) => ({
    id: row.id, from: row.origin, to: row.destination, distance: row.distance,
    duration: row.duration, fare: Number(row.fare), boarding: row.boarding_point, status: row.status,
  }));
}

export async function fetchBuses(publicOnly = false, executor = pool) {
  const result = await rows(
    `SELECT id, registration, service, seats, model, model_year, status, next_service
     FROM buses ${publicOnly ? "WHERE status <> 'Retired'" : ""} ORDER BY registration`,
    [], executor,
  );
  return result.map((row) => ({
    id: row.id, registration: row.registration, service: row.service, seats: Number(row.seats),
    model: row.model, year: Number(row.model_year), status: row.status, nextService: row.next_service,
  }));
}

export async function fetchCrew(executor = pool) {
  const result = await rows("SELECT id, name, role, phone, cnic, license, duty, status, initials FROM crew ORDER BY name", [], executor);
  return result.map((row) => ({ ...row, id: Number(row.id) }));
}

export async function fetchUsers(executor = pool) {
  const result = await rows("SELECT id, name, email, username, role, active, force_password_change, last_login_at, created_at FROM users ORDER BY name", [], executor);
  return result.map((row) => ({
    id: Number(row.id), name: row.name, email: row.email, username: row.username, role: row.role,
    active: Boolean(row.active), forcePasswordChange: Boolean(row.force_password_change),
    lastLoginAt: isoDateTime(row.last_login_at), createdAt: isoDateTime(row.created_at),
  }));
}

export async function fetchTrips(activeOnly = false, executor = pool) {
  const result = await rows(
    `SELECT id, route_id, bus_id, departure, arrival, driver, attendant, platform, status,
            service_days, active, run_number, last_departed_at
     FROM trips ${activeOnly ? "WHERE active = 1" : ""} ORDER BY departure`,
    [], executor,
  );
  return result.map((row) => ({
    id: row.id, routeId: row.route_id, busId: row.bus_id, departure: trimTime(row.departure),
    arrival: trimTime(row.arrival), driver: row.driver, attendant: row.attendant, platform: row.platform,
    status: row.status, days: parseJson(row.service_days), active: Boolean(row.active),
    runNumber: Number(row.run_number), lastDepartedAt: isoDateTime(row.last_departed_at),
  }));
}

export async function fetchTripRuns(serviceDate = null, executor = pool) {
  const result = await rows(
    `SELECT tr.id, tr.trip_id, tr.service_date, tr.run_number, tr.bus_id, tr.driver,
            tr.attendant, tr.platform, tr.status, tr.notes, tr.boarding_started_at, tr.departed_at, tr.returned_at, tr.snapshot
     FROM trip_runs tr
     ${serviceDate ? 'WHERE tr.service_date = ?' : ''}
     ORDER BY tr.service_date DESC, tr.id`,
    serviceDate ? [serviceDate] : [], executor,
  );
  return result.map((row) => ({
    id: row.id,
    tripId: row.trip_id,
    date: row.service_date,
    runNumber: Number(row.run_number),
    busId: row.bus_id,
    driver: row.driver,
    attendant: row.attendant,
    platform: row.platform,
    status: row.status,
    notes: row.notes,
    boardingStartedAt: isoDateTime(row.boarding_started_at),
    departedAt: isoDateTime(row.departed_at),
    returnedAt: isoDateTime(row.returned_at),
    snapshot: parseJson(row.snapshot, null),
  }));
}

async function mapBooking(row, executor = pool) {
  const seats = await rows("SELECT seat_number FROM booking_seats WHERE booking_id = ? ORDER BY seat_number", [row.id], executor);
  const refunds = await rows(
    `SELECT r.id, r.amount, r.method, r.reason, r.reference, r.notes, r.processed_at, u.name processed_by_name
     FROM refunds r JOIN users u ON u.id = r.processed_by WHERE r.booking_id = ? ORDER BY r.processed_at`,
    [row.id], executor,
  );
  return {
    id: row.id, ticketNo: row.ticket_no, source: row.source, passenger: row.passenger,
    phone: row.phone, cnic: row.cnic, gender: row.gender, route: row.route_label,
    destination: row.destination, boardingPoint: row.boarding_point, bus: row.bus_registration,
    service: row.service, seats: seats.map((item) => Number(item.seat_number)), fare: Number(row.fare),
    discount: Number(row.discount), total: Number(row.total), paid: Number(row.paid), balance: Number(row.balance),
    paymentMethod: row.payment_method, paymentReference: row.payment_reference, paymentStatus: row.payment_status,
    bookingStatus: row.booking_status, date: row.travel_date, time: trimTime(row.travel_time),
    driver: row.driver, attendant: row.attendant, createdAt: isoDateTime(row.created_at),
    expiresAt: isoDateTime(row.expires_at), tripId: row.trip_id, tripRunId: row.trip_run_id,
    seatPrintedAt: isoDateTime(row.seat_printed_at), issuedBy: row.issued_by, terminal: row.terminal,
    refunds: refunds.map((refund) => ({
      id: refund.id, amount: Number(refund.amount), method: refund.method, reason: refund.reason,
      reference: refund.reference, notes: refund.notes, processedAt: isoDateTime(refund.processed_at),
      processedBy: refund.processed_by_name,
    })),
  };
}

export async function fetchBooking(id, executor = pool) {
  const result = await rows("SELECT * FROM bookings WHERE id = ? LIMIT 1", [id], executor);
  return result[0] ? mapBooking(result[0], executor) : null;
}

export async function fetchBookings(executor = pool) {
  const result = await rows("SELECT * FROM bookings ORDER BY created_at DESC", [], executor);
  return Promise.all(result.map((row) => mapBooking(row, executor)));
}

export async function fetchExpenses(executor = pool) {
  const result = await rows(
    `SELECT e.id, e.expense_date, e.category, e.description, e.amount, e.payment_method,
            e.reference, e.notes, e.shift_id, e.created_at, u.name created_by_name
     FROM expenses e JOIN users u ON u.id = e.created_by ORDER BY e.expense_date DESC, e.id DESC LIMIT 1000`,
    [], executor,
  );
  return result.map((row) => ({
    id: Number(row.id), date: row.expense_date, category: row.category, description: row.description,
    amount: Number(row.amount), paymentMethod: row.payment_method, reference: row.reference,
    notes: row.notes, shiftId: row.shift_id == null ? null : Number(row.shift_id),
    createdBy: row.created_by_name, createdAt: isoDateTime(row.created_at),
  }));
}

export async function publicOccupancy(executor = pool) {
  const result = await rows(
    `SELECT bs.trip_run_id, b.bus_registration, b.travel_date, b.travel_time, bs.seat_number
     FROM booking_seats bs JOIN bookings b ON b.id = bs.booking_id
     WHERE bs.active = 1 AND b.booking_status IN ('Confirmed','Reserved')`,
    [], executor,
  );
  const groups = new Map();
  for (const row of result) {
    if (!groups.has(row.trip_run_id)) groups.set(row.trip_run_id, {
      tripRunId: row.trip_run_id, bus: row.bus_registration, date: row.travel_date,
      time: trimTime(row.travel_time), seats: [],
    });
    groups.get(row.trip_run_id).seats.push(Number(row.seat_number));
  }
  return [...groups.values()];
}
