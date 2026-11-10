import { pool } from "./db.js";
import { isoDateTime, parseJson, trimTime } from "./helpers.js";

const rows = async (sql, parameters = [], executor = pool) => {
  const [result] = await executor.execute(sql, parameters);
  return result;
};

export async function fetchRoutes(activeOnly = false, executor = pool) {
  const result = await rows(
    `SELECT id, origin, destination, distance, duration, fare, boarding_point, status, destinations, services, deleted_at
     FROM routes ${activeOnly ? "WHERE status = 'Active' AND deleted_at IS NULL" : ""} ORDER BY origin, destination`,
    [], executor,
  );
  return result.map((row) => ({
    deleted: Boolean(row.deleted_at), id: row.id, from: row.origin, to: row.destination, distance: row.distance,
    destinations: parseJson(row.destinations), services: parseJson(row.services), duration: row.duration, fare: Number(row.fare), boarding: row.boarding_point, status: row.status,
  }));
}

export async function fetchBuses(publicOnly = false, executor = pool) {
  const result = await rows(
    `SELECT id, registration, service, seats, model, model_year, status, next_service, is_template, seat_classes, commission_rate, deleted_at
     FROM buses ${publicOnly ? "WHERE status <> 'Retired' AND deleted_at IS NULL" : ""} ORDER BY registration`,
    [], executor,
  );
  return result.map((row) => ({
    seatClasses: parseJson(row.seat_classes), commissionRate: Number(row.commission_rate), id: row.id, registration: row.registration, service: row.service, seats: Number(row.seats),
    isTemplate: Boolean(row.is_template), deleted: Boolean(row.deleted_at), model: row.model, year: Number(row.model_year), status: row.status, nextService: row.next_service,
  }));
}

export async function fetchCrew(executor = pool) {
  const result = await rows("SELECT id, name, role, phone, cnic, license, duty, status, initials FROM crew WHERE deleted_at IS NULL ORDER BY name", [], executor);
  return result.map((row) => ({ ...row, id: Number(row.id) }));
}

export async function fetchUsers(executor = pool, id = null) {
  const result = await rows(
    `SELECT id, name, username, role, active, force_password_change, last_login_at, created_at
     FROM users WHERE active = 1 ${id === null ? "" : "AND id = ?"} ORDER BY name`,
    id === null ? [] : [id], executor,
  );
  return result.map((row) => ({
    id: Number(row.id), name: row.name, username: row.username, role: row.role,
    active: Boolean(row.active), forcePasswordChange: Boolean(row.force_password_change),
    lastLoginAt: isoDateTime(row.last_login_at), createdAt: isoDateTime(row.created_at),
  }));
}

export async function fetchTrips(activeOnly = false, executor = pool) {
  const result = await rows(
    `SELECT id, route_id, bus_id, departure, arrival, driver, attendant, platform, status,
            service_days, active, run_number, last_departed_at, deleted_at
     FROM trips ${activeOnly ? "WHERE active = 1 AND deleted_at IS NULL" : ""} ORDER BY departure`,
    [], executor,
  );
  return result.map((row) => ({
    id: row.id, routeId: row.route_id, busId: row.bus_id, departure: trimTime(row.departure),
    arrival: trimTime(row.arrival), driver: row.driver, attendant: row.attendant, platform: row.platform,
    status: row.status, days: parseJson(row.service_days), active: Boolean(row.active),
    deleted: Boolean(row.deleted_at), runNumber: Number(row.run_number), lastDepartedAt: isoDateTime(row.last_departed_at),
  }));
}

export async function fetchTripRuns(serviceDate = null, executor = pool) {
  const result = await rows(
    `SELECT tr.id, tr.trip_id, tr.service_date, tr.run_number, tr.bus_id, tr.driver,
            tr.attendant, tr.platform, tr.status, tr.notes, tr.sales_paused, tr.sales_override, tr.boarding_started_at, tr.departed_at, tr.returned_at, tr.snapshot
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
    salesPaused: Boolean(row.sales_paused), salesOverride: Boolean(row.sales_override),
    boardingStartedAt: isoDateTime(row.boarding_started_at),
    departedAt: isoDateTime(row.departed_at),
    returnedAt: isoDateTime(row.returned_at),
    snapshot: parseJson(row.snapshot, null),
  }));
}

const refundDetails = `SELECT r.id, r.booking_id, r.amount, r.method, r.reason, r.reference, r.notes,
  r.processed_at, u.name processed_by_name FROM refunds r JOIN users u ON u.id = r.processed_by`;

function mapBooking(row, seats, refunds) {
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

export function normalizeBookingPhone(phone) {
  if (typeof phone !== "string" || phone.length > 30 || !/^\+?[0-9().\s-]+$/.test(phone.trim())) return "";
  const digits = phone.replace(/\D/g, "").replace(/^(?:0092|92)(3\d{9})$/, "0$1");
  return /^\d{7,15}$/.test(digits) ? digits : "";
}

export async function lookupJourney(reference, phone) {
  const [booking] = await rows(
    `SELECT id, ticket_no, phone, route_label, destination, boarding_point, service, travel_date, travel_time,
            booking_status, expires_at,
            (expires_at <= NOW() AND (booking_status = 'Reserved' OR
              (booking_status = 'Cancelled' AND updated_at >= expires_at))) AS expired
     FROM bookings WHERE ticket_no = ? OR reservation_no = ? LIMIT 1`,
    [reference, reference],
  );
  if (!booking || normalizeBookingPhone(booking.phone) !== phone) return null;

  const seats = await rows("SELECT seat_number FROM booking_seats WHERE booking_id = ? ORDER BY seat_number", [booking.id]);
  const status = booking.expired ? "Expired" : booking.booking_status;
  return {
    reference: booking.ticket_no,
    status,
    route: booking.route_label,
    destination: booking.destination,
    boardingPoint: booking.boarding_point,
    service: booking.service,
    date: booking.travel_date,
    time: trimTime(booking.travel_time),
    seats: seats.map(seat => Number(seat.seat_number)),
    expiresAt: status === "Reserved" ? isoDateTime(booking.expires_at) : null,
  };
}

export async function fetchBooking(id, executor = pool) {
  const [row] = await rows("SELECT * FROM bookings WHERE id = ? LIMIT 1", [id], executor);
  if (!row) return null;
  const seats = await rows("SELECT seat_number FROM booking_seats WHERE booking_id = ? ORDER BY seat_number", [id], executor);
  const refunds = await rows(`${refundDetails} WHERE r.booking_id = ? ORDER BY r.processed_at`, [id], executor);
  return mapBooking(row, seats, refunds);
}

function groupByBooking(records) {
  const groups = new Map();
  for (const record of records) {
    const group = groups.get(record.booking_id);
    if (group) group.push(record);
    else groups.set(record.booking_id, [record]);
  }
  return groups;
}

export async function fetchBookings(executor = pool) {
  const [bookings, seats, refunds] = await Promise.all([
    rows("SELECT * FROM bookings ORDER BY created_at DESC", [], executor),
    rows("SELECT booking_id, seat_number FROM booking_seats ORDER BY booking_id, seat_number", [], executor),
    rows(`${refundDetails} ORDER BY r.booking_id, r.processed_at`, [], executor),
  ]);
  const bookingSeats = groupByBooking(seats);
  const bookingRefunds = groupByBooking(refunds);
  return bookings.map(row => mapBooking(row, bookingSeats.get(row.id) ?? [], bookingRefunds.get(row.id) ?? []));
}

export async function fetchExpenses(executor = pool) {
  const result = await rows(
    `SELECT e.id, e.expense_date, e.category, e.description, e.amount, e.payment_method,
            e.reference, e.notes, e.shift_id, e.created_at, u.name created_by_name
     FROM expenses e JOIN users u ON u.id = e.created_by ORDER BY e.expense_date DESC, e.id DESC`,
    [], executor,
  );
  return result.map((row) => ({
    id: Number(row.id), date: row.expense_date, category: row.category, description: row.description,
    amount: Number(row.amount), paymentMethod: row.payment_method, reference: row.reference,
    notes: row.notes, shiftId: row.shift_id == null ? null : Number(row.shift_id),
    createdBy: row.created_by_name, createdAt: isoDateTime(row.created_at),
  }));
}

export async function publicOccupancy(date, executor = pool) {
  const result = await rows(
    `SELECT bs.trip_run_id, b.bus_registration, b.travel_date, b.travel_time, bs.seat_number
     FROM booking_seats bs JOIN bookings b ON b.id = bs.booking_id
     WHERE b.travel_date = ? AND bs.active = 1 AND b.booking_status IN ('Confirmed','Reserved')
       AND (b.expires_at IS NULL OR b.expires_at > NOW())`,
    [date], executor,
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
