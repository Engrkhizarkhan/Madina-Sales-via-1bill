import {seatFare,routeDestinations,commissionPolicy} from '../../shared/service-pricing.mjs';
import {validateClasses,validateRouteConfig} from './service-config.js';
import bcrypt from "bcryptjs";
import { config } from "./config.js";
import { ensureRun, assertSaleOpen } from './departures.js';
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

async function nextTicketNumber(connection,reserved=false) {
  const result=await query(connection,'INSERT INTO ticket_numbers VALUES ()');
  return `${reserved?'RS':'ME'}-${Number(result.insertId).toString(36).toUpperCase().padStart(6,'0')}`;
}
function passengerDetails(data,reserved) {
  requireFields(data,reserved?['passenger','phone']:['passenger','phone','cnic','gender']);
  for(const [field,max] of [['passenger',160],['phone',30],['cnic',50]]) if(String(data[field]||'').length>max) fail(`${field} is too long.`,422,'validation_error');
  if(!reserved) allowed(data.gender,['Male','Female'],'gender');
  return {passenger:String(data.passenger).trim(),phone:String(data.phone).trim(),cnic:String(data.cnic||'').trim(),gender:['Male','Female'].includes(data.gender)?data.gender:'Unspecified'};
}

function counterFares(fares, overrides) {
  if (overrides === undefined) return fares;
  if (!Array.isArray(overrides) || overrides.length !== fares.length) {
    fail("Enter a fare for each selected seat.", 422, "validation_error");
  }
  return fares.map((fare, index) => {
    const override = overrides[index];
    if (override === null) return fare;
    if (typeof override !== "number" || override < 0 || override > 9999999999.99) {
      fail("Enter a valid fare for the selected seat.", 422, "validation_error");
    }
    return decimal(override, "Fare");
  });
}

export async function releaseExpiredReservations(executor = pool, tripRunId = null) {
  await query(executor,
    `UPDATE bookings b JOIN booking_seats bs ON bs.booking_id = b.id
     SET b.booking_status = 'Cancelled', bs.active = 0
     WHERE b.booking_status = 'Reserved' AND b.expires_at <= NOW()
     ${tripRunId ? "AND b.trip_run_id = ?" : ""}`,
    tripRunId ? [tripRunId] : [],
  );
}

export async function createBooking(data, user, isPublic, req) {
  const reserved = isPublic || data.bookingStatus === "Reserved";
  if (isPublic) {
    const phone = String(data.phone || "").replace(/[\s()-]/g, "").replace(/^(?:\+92|0092)/, "0");
    if (!/^03\d{9}$/.test(phone)) fail("Enter a valid Pakistani mobile number.", 422, "validation_error");
    data = { ...data, phone, cnic: "", gender: "Unspecified", boardingPoint: undefined };
  }
  const details=passengerDetails(data,reserved);
  requireFields(data, ["tripId", "date", "seats"]);
  const seats = [...new Set(Array.isArray(data.seats) ? data.seats.map(Number).filter(Number.isInteger) : [])];
  if (!seats.length) fail("Select at least one seat.", 422, "validation_error");
  if (isPublic && seats.length > 4) fail("Online bookings are limited to four seats.", 422, "validation_error");
  for (const [field, maximum] of [["passenger", 160], ["phone", 30], ["cnic", 50]]) {
    if (String(data[field]).trim().length > maximum) fail(`${field} is too long.`, 422, "validation_error");
  }
  return transaction(async (connection) => {
    const trips = await query(connection,
      `SELECT t.*, r.origin, r.destination, r.fare route_fare, r.boarding_point, r.status route_status, r.deleted_at route_deleted,
              b.registration, b.service, b.seats capacity, b.status bus_status
       FROM trips t JOIN routes r ON r.id = t.route_id JOIN buses b ON b.id = t.bus_id
       WHERE t.id = ? FOR UPDATE`, [String(data.tripId)]);
    const trip = trips[0];
    if (!trip || trip.deleted_at || trip.route_deleted || !trip.active || trip.route_status !== "Active") {
      fail("This departure is not available for booking.", 409, "departure_unavailable");
    }
    const travelDate = String(data.date);
    if (!validDate(travelDate) || travelDate < pakistanDate()) fail("Choose today or a future travel date.", 422, "validation_error");
    if (isPublic && travelDate > pakistanDate(new Date(Date.now() + 90 * 86400000))) {
      fail("Online reservations open 90 days before departure.", 422, "validation_error");
    }
    if (!parseJson(trip.service_days).includes(weekday(travelDate))) fail("This trip does not run on the selected date.", 409, "departure_unavailable");
    const run = await ensureRun(connection, trip, travelDate);
    await assertSaleOpen(connection, run, travelDate, isPublic);
    if (!isPublic && ((data.bus !== undefined && data.bus !== run.snapshot.bus.registration) || (data.time !== undefined && data.time !== run.snapshot.departure) || (data.service !== undefined && data.service !== run.snapshot.bus.service))) {
      fail('This departure changed while you were booking. Refresh and select the seats again.',409,'assignment_changed');
    }
    const tripRunId = run.id;
    if (seats.some((seat) => seat < 1 || seat > Number(run.snapshot.bus.seats))) fail("One or more selected seats are invalid.", 422, "validation_error");
    await releaseExpiredReservations(connection, tripRunId);

    const paymentMethod = reserved ? "Cash" : String(data.paymentMethod || "Cash");
    allowed(paymentMethod, ["Cash", "Card", "Bank transfer", "1Bill"], "paymentMethod");
    if (paymentMethod === "1Bill" && config.paymentMode === "disabled") fail("1Bill is not active yet. Choose cash or card.", 409, "payment_unavailable");
    let paymentReference = String(data.paymentReference || "").trim();
    if (!reserved && paymentMethod !== "Cash" && !paymentReference) fail("A verified payment reference is required.", 422, "validation_error");
    paymentReference = reserved ? '' : paymentReference || `CASH-${timeCode()}`;
    const route=(await fetchRoutes(false,connection)).find(r=>r.id===trip.route_id) || run.snapshot.route;
    const destination=String(data.destination || routeDestinations(route).at(-1).name);
    const managed=(await fetchBuses(false,connection)).find(b=>b.id===(run.snapshot.bus.layoutId||run.snapshot.bus.id));
    const pricingBus={...run.snapshot.bus,...(managed?{seatClasses:managed.seatClasses}:{})};
    const baseFares = seats.map(seat => seatFare(route, pricingBus, destination, seat));
    if(baseFares.some(f=>!Number.isFinite(f))) fail('Choose a destination on this route.',422,'validation_error');
    if(data.quotedFares && (!Array.isArray(data.quotedFares)||data.quotedFares.length!==baseFares.length||baseFares.some((fare,index)=>Number(data.quotedFares[index])!==fare))) fail('Fares changed while you were booking. Refresh and review the current fares.',409,'fare_changed');
    const fares = isPublic || reserved ? baseFares : counterFares(baseFares, data.fareOverrides);
    const batchDiscount = reserved || isPublic ? 0 : Math.min(decimal(data.discount ?? 0, "discount"), fares.reduce((sum,fare)=>sum+fare,0));
    let discountCents = Math.round(batchDiscount * 100);
    let fareCents=fares.reduce((sum,fare)=>sum+Math.round(fare*100),0);
    const createdBookings = [];
    // One transaction for the whole selection: a conflict rolls back every seat.
    for (const [index, seat] of seats.entries()) {
      const fare=fares[index];
      const share=fareCents?Math.round(discountCents*Math.round(fare*100)/fareCents):0;
      const discount=share/100;
      discountCents-=share;fareCents-=Math.round(fare*100);
      const total = Math.round((fare - discount) * 100) / 100;
      const paid = reserved ? 0 : total;
      const id = uuid("booking-");
      const ticketNo = await nextTicketNumber(connection,reserved);
      const departure = Date.parse(`${travelDate}T${run.snapshot.departure.slice(0, 5)}:00+05:00`);
      const expiresAt = isPublic ? sqlDateTime(new Date(Math.min(departure, Date.now() + 2 * 60 * 60 * 1000))) : null;
      await query(connection,
        `INSERT INTO bookings
         (id, ticket_no, source, passenger, phone, cnic, gender, route_label, destination, boarding_point,
          bus_registration, service, fare, discount, total, paid, balance, payment_method, payment_reference,
          payment_status, booking_status, travel_date, travel_time, driver, attendant, trip_id, trip_run_id,
          expires_at, seat_printed_at, issued_by, terminal, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, ticketNo, isPublic ? "Public web" : "Counter", details.passenger, details.phone,
          details.cnic, details.gender,
          `${route.from} → ${route.to}`, destination, String(data.boardingPoint || run.snapshot.route.boarding).trim(),
          (run.snapshot.bus.isTemplate ? "To be assigned" : run.snapshot.bus.registration), run.snapshot.bus.service, fare, discount, total, paid, reserved ? total : 0, paymentMethod, paymentReference,
          reserved ? "Unpaid" : "Paid", reserved ? "Reserved" : "Confirmed", travelDate, run.snapshot.departure, run.driver,
          run.attendant, trip.id, tripRunId, expiresAt, reserved ? null : sqlDateTime(), user?.name || "Public website",
          "Madina Terminal, Peshawar", user?.id || null]);
      await query(connection, "INSERT INTO booking_seats (booking_id, trip_run_id, seat_number, active) VALUES (?, ?, ?, 1)", [id, tripRunId, seat]);
      if (!reserved) {
        await query(connection,
          "INSERT INTO financial_transactions (booking_id, transaction_type, amount, payment_method, reference, description, created_by) VALUES (?, 'sale', ?, ?, ?, ?, ?)",
          [id, paid, paymentMethod, paymentReference, `Ticket ${ticketNo}`, user?.id || null]);
      }
      const created = await fetchBooking(id, connection);
      await audit("booking.created", "booking", id, null, created, user?.id, req, connection);
      createdBookings.push(created);
    }
    return createdBookings;
  });
}

export async function updateBooking(id, data, user, req) {
  return transaction(async connection=>{
    const [lookup]=await query(connection,'SELECT trip_id FROM bookings WHERE id=?',[id]);
    if(!lookup) fail('Booking not found.',404,'not_found');
    await query(connection,'SELECT id FROM trips WHERE id=? FOR UPDATE',[lookup.trip_id]);
    await query(connection,'SELECT id FROM bookings WHERE id=? FOR UPDATE',[id]);
    const before=await fetchBooking(id,connection);
    if(['Cancelled','Refunded'].includes(before.bookingStatus)) fail('Closed bookings cannot be edited.',409,'booking_closed');
    const details=passengerDetails(data,before.bookingStatus==='Reserved');
    if(before.bookingStatus!=='Reserved' && data.destination!==before.destination) fail('Refund and reissue the ticket to change its destination and fare.',409,'reissue_required');
    await query(connection,'UPDATE bookings SET passenger=?,phone=?,cnic=?,gender=?,boarding_point=? WHERE id=?',[details.passenger,details.phone,details.cnic,details.gender,String(data.boardingPoint||'').trim(),id]);
    const after=await fetchBooking(id,connection);
    await audit('booking.updated','booking',id,before,after,user.id,req,connection);
    return after;
  });
}

export async function cancelBooking(id, user, req) {
  return transaction(async (connection) => {
    await query(connection, 'SELECT id FROM bookings WHERE id = ? FOR UPDATE', [id]);
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
    const lookup = await query(connection, 'SELECT trip_id, travel_date FROM bookings WHERE id = ?', [id]);
    if (!lookup.length) fail('Reservation not found.', 404, 'not_found');
    const [trip] = await query(connection, 'SELECT * FROM trips WHERE id = ? FOR UPDATE', [lookup[0].trip_id]);
    const run = await ensureRun(connection, trip, lookup[0].travel_date);
    await assertSaleOpen(connection, run, lookup[0].travel_date);
    const records = await query(
      connection,
      "SELECT * FROM bookings WHERE id = ? FOR UPDATE",
      [id],
    );
    const row = records[0];
    if (!row || row.booking_status !== "Reserved" || (row.expires_at && Date.parse(isoDateTime(row.expires_at)) <= Date.now())) fail("Active reservation not found.", 404, "not_found");
    const method = allowed(String(data.paymentMethod || "Cash"), ["Cash", "Card", "Bank transfer", "1Bill"], "paymentMethod");
    if (method === "1Bill" && config.paymentMode === "disabled") fail("1Bill is not active yet. Choose cash or card.", 409, "payment_unavailable");
    let reference = String(data.paymentReference || "").trim();
    if (method !== "Cash" && !reference) fail("A verified payment reference is required.", 422, "validation_error");
    reference ||= `CASH-${timeCode()}`;
    const details=passengerDetails({...row,...data},false);
    const route=(await fetchRoutes(false,connection)).find(r=>r.id===trip.route_id)||run.snapshot.route;
    const destination=String(data.destination||row.destination||routeDestinations(route).at(-1).name);
    const seats = await query(connection, 'SELECT seat_number FROM booking_seats WHERE booking_id=? ORDER BY seat_number', [id]);
    if (!seats.length) fail('This reservation has no seats.', 409, 'reservation_empty');
    const managed=(await fetchBuses(false,connection)).find(b=>b.id===(run.snapshot.bus.layoutId||run.snapshot.bus.id));
    const pricingBus = { ...run.snapshot.bus, ...(managed ? { seatClasses: managed.seatClasses } : {}) };
    const baseFares = seats.map(seat => seatFare(route, pricingBus, destination, Number(seat.seat_number)));
    if (baseFares.some(fare => !Number.isFinite(fare))) fail('Choose a destination on this route.', 422, 'validation_error');
    const fares = counterFares(baseFares, data.fareOverrides);
    const fareTotal = decimal(fares.reduce((sum, fare) => sum + fare, 0), 'Fare');
    if (fareTotal > 9999999999.99) fail('The total fare is too large.', 422, 'validation_error');
    const fare = decimal(fareTotal / seats.length, 'Fare');
    const discount = Math.min(decimal(data.discount ?? 0, 'discount'), fareTotal);
    const total = decimal(fareTotal - discount, 'Total');
    const ticketNo = await nextTicketNumber(connection);
    const before = await fetchBooking(id, connection);
    await query(connection,
      "UPDATE bookings SET reservation_no=COALESCE(reservation_no,ticket_no),ticket_no=?,passenger=?,phone=?,cnic=?,gender=?,destination=?,boarding_point=?,fare=?,discount=?,total=?,paid=?,balance=0,payment_method=?,payment_reference=?,payment_status='Paid',booking_status='Confirmed',expires_at=NULL,seat_printed_at=NOW(),issued_by=? WHERE id=?",
      [ticketNo,details.passenger,details.phone,details.cnic,details.gender,destination,String(data.boardingPoint||row.boarding_point||route.boarding),fare,discount,total,total,method,reference,user.name,id]);
    await query(connection,
      "INSERT INTO financial_transactions (booking_id, transaction_type, amount, payment_method, reference, description, created_by) VALUES (?, 'sale', ?, ?, ?, ?, ?)",
      [id, total, method, reference, `Confirmed reservation ${ticketNo}`, user.id]);
    const after = await fetchBooking(id, connection);
    await audit("reservation.confirmed", "booking", id, before, after, user.id, req, connection);
    return after;
  });
}

export async function refundBooking(id, data, user, req) {
  requireFields(data, ["amount", "method", "reason"]);
  return transaction(async (connection) => {
    // Match the departure lock order used by sales and vouchers for a consistent ledger basis.
    const [lookup] = await query(connection, 'SELECT trip_id FROM bookings WHERE id = ?', [id]);
    if (lookup) await query(connection, 'SELECT id FROM trips WHERE id = ? FOR UPDATE', [lookup.trip_id]);
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
      [full ? "Refunded" : "Partially refunded", full ? "Refunded" : data.releaseSeats === true ? "Cancelled" : row.booking_status, id]);
    if (full || data.releaseSeats === true) await query(connection, "UPDATE booking_seats SET active = 0 WHERE booking_id = ?", [id]);
    await query(connection,
      "INSERT INTO financial_transactions (booking_id, refund_id, transaction_type, amount, payment_method, reference, description, created_by) VALUES (?, ?, 'refund', ?, ?, ?, ?, ?)",
      [id, refundId, -amount, method, reference, `Refund: ${reason}`, user.id]);
    const after = await fetchBooking(id, connection);
    await audit("booking.refunded", "booking", id, before, after, user.id, req, connection);
    return after;
  });
}

export async function saveRoute(id, data, user, req) {
  requireFields(data, ["from", "to", "fare", "boarding", "status"]);
  data={distance:"",duration:"",...data};
  const recordId = id === "new" ? uuid("route-") : id;
  const before = (await fetchRoutes()).find((item) => item.id === recordId) || null;
  const settings=validateRouteConfig({...data,destinations:data.destinations??before?.destinations??[],services:data.services??before?.services??[]},await fetchBuses());
  await query(pool,
    `INSERT INTO routes (id, origin, destination, distance, duration, fare, boarding_point, status, destinations, services) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE origin = VALUES(origin), destination = VALUES(destination), distance = VALUES(distance),
       duration = VALUES(duration), fare = VALUES(fare), boarding_point = VALUES(boarding_point), status = VALUES(status), destinations=VALUES(destinations), services=VALUES(services)`,
    [recordId, String(data.from).trim(), String(data.to).trim(), String(data.distance).trim(), String(data.duration).trim(),
      decimal(data.fare, "fare"), String(data.boarding).trim(), data.status === "Paused" ? "Paused" : "Active",JSON.stringify(settings.destinations),JSON.stringify(settings.services)]);
  const after = (await fetchRoutes()).find((item) => item.id === recordId);
  await audit(before ? "route.updated" : "route.created", "route", recordId, before, after, user.id, req);
  return after;
}

export async function saveBus(id, data, user, req) {
  requireFields(data, ["service", "seats", "model"]);
  if (!Number.isInteger(Number(data.seats)) || Number(data.seats)<1 || Number(data.seats)>100) fail('Seat capacity must be between 1 and 100.',422,'validation_error');
  const template = data.isTemplate === true || !data.registration;
  data = {...data, registration:data.registration || `LAYOUT-${uuid().slice(-12)}`, year:data.year || new Date().getFullYear(), status:data.status || 'Ready', nextService:data.nextService || 'Not scheduled'};
  const recordId = id === "new" ? String(data.registration).trim().toLowerCase().replace(/[^a-z0-9]+/g, "-") : id;
  return transaction(async (connection) => {
  await query(connection, "SELECT id FROM buses WHERE id = ? FOR UPDATE", [recordId]);
  const before = (await fetchBuses(false, connection)).find((item) => item.id === recordId) || null;
  allowed(data.status, ['Ready', 'On route', 'Maintenance', 'Retired'], 'status');
  const held = await query(connection, `SELECT MAX(bs.seat_number) seat FROM booking_seats bs JOIN bookings b ON b.id = bs.booking_id
    JOIN trip_runs tr ON tr.id = b.trip_run_id WHERE tr.bus_id = ? AND tr.status IN ('Scheduled','Boarding') AND bs.active = 1`, [recordId]);
  if (Number(held[0]?.seat || 0) > Number(data.seats)) fail('The capacity cannot be smaller than a sold or reserved seat number.', 409, 'seats_in_use');
  const classes=validateClasses(data.seatClasses??before?.seatClasses??[],Number(data.seats));
  const commission=decimal(data.commissionRate??before?.commissionRate??0,'commission rate');
  if(commission>100) fail('Commission cannot exceed 100%.',422,'validation_error');
  await query(connection,
    `INSERT INTO buses (id, registration, service, seats, model, model_year, status, next_service, is_template, seat_classes, commission_rate) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE registration = VALUES(registration), service = VALUES(service), seats = VALUES(seats),
       model = VALUES(model), model_year = VALUES(model_year), status = VALUES(status), next_service = VALUES(next_service), is_template = VALUES(is_template),seat_classes=VALUES(seat_classes),commission_rate=VALUES(commission_rate)`,
    [recordId, String(data.registration).trim().toUpperCase(), String(data.service).trim(), Number(data.seats),
      String(data.model).trim(), Number(data.year), data.status, String(data.nextService).trim(), template ? 1 : 0,JSON.stringify(classes),commission]);
  const after = (await fetchBuses(false, connection)).find((item) => item.id === recordId);
  await audit(before ? "bus.updated" : "bus.created", "bus", recordId, before, after, user.id, req, connection);
  return after;
  });
}

export async function saveTrip(id, data, user, req) {
  data={driver:"",attendant:"",platform:"",...data};
  requireFields(data, ["routeId", "busId", "departure", "arrival", "status", "days"]);
  const recordId = id === "new" ? uuid("trip-") : id;
  return transaction(async (connection) => {
  await query(connection, "SELECT id FROM trips WHERE id = ? FOR UPDATE", [recordId]);
  const days = Array.isArray(data.days) ? data.days.filter((day) => ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].includes(day)) : [];
  if (!days.length) fail("Select at least one service day.", 422, "validation_error");
  const assignedBus=(await fetchBuses(false,connection)).find(b=>b.id===data.busId&&!b.deleted);
  if(!assignedBus) fail("Choose a bus layout.",422,"validation_error");
  const conflicts = (await fetchTrips(false, connection)).filter((trip) =>
    trip.id !== recordId && trip.active && data.active &&
    trip.departure === String(data.departure).slice(0, 5) &&
    trip.days.some((day) => days.includes(day)) &&
    ((!assignedBus.isTemplate && trip.busId === data.busId) || (data.driver && trip.driver === String(data.driver).trim()) || (data.attendant && trip.attendant === String(data.attendant).trim())),
  );
  if (conflicts.length) {
    fail("This bus or crew member already has a trip at the same time on one of the selected days.", 409, "roster_conflict");
  }
  const before = (await fetchTrips(false, connection)).find((item) => item.id === recordId) || null;
  if(before?.deleted) fail("This schedule was deleted. Add a new schedule instead.",409,"schedule_deleted");
  const changingAssignment = before && (before.routeId !== data.routeId || before.busId !== data.busId || before.departure !== data.departure || before.arrival !== data.arrival || before.driver !== data.driver || before.attendant !== data.attendant || before.platform !== data.platform || [...before.days].sort().join() !== [...days].sort().join());
  if (changingAssignment) {
    // Empty future snapshots can be rebuilt from the amended schedule.
    await query(connection, "DELETE FROM trip_runs WHERE trip_id = ? AND service_date >= ? AND status = 'Scheduled' AND NOT EXISTS (SELECT 1 FROM bookings b WHERE b.trip_run_id = trip_runs.id)", [recordId, pakistanDate()]);
  }
  await query(connection,
    `INSERT INTO trips (id, route_id, bus_id, departure, arrival, driver, attendant, platform, status, service_days, active, run_number, last_departed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE route_id = VALUES(route_id), bus_id = VALUES(bus_id), departure = VALUES(departure),
       arrival = VALUES(arrival), driver = VALUES(driver), attendant = VALUES(attendant), platform = VALUES(platform),
       status = VALUES(status), service_days = VALUES(service_days), active = VALUES(active),
       run_number = VALUES(run_number)`,
    [recordId, data.routeId, data.busId, data.departure, data.arrival, String(data.driver).trim(),
      String(data.attendant).trim(), String(data.platform).trim(), "Scheduled", JSON.stringify(days), data.active ? 1 : 0,
      1, null]);
  const after = (await fetchTrips(false, connection)).find((item) => item.id === recordId);
  await audit(before ? "trip.updated" : "trip.created", "trip", recordId, before, after, user.id, req, connection);
  return after;
  });
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
  return transaction(async connection=>{
    const [before]=await query(connection,'SELECT * FROM routes WHERE id=? AND deleted_at IS NULL FOR UPDATE',[id]);
    if(!before) fail('Route not found.',404,'not_found');
    await query(connection,'UPDATE trips SET active=0, deleted_at=COALESCE(deleted_at,NOW()) WHERE route_id=?',[id]);
    await query(connection,"UPDATE routes SET status='Paused', deleted_at=NOW() WHERE id=?",[id]);
    await audit('route.deleted','route',id,before,{deleted:true,historyRetained:true},user.id,req,connection);
  });
}

export async function deleteBus(id, user, req) {
  return transaction(async connection=>{
    const [before]=await query(connection,'SELECT * FROM buses WHERE id=? AND deleted_at IS NULL FOR UPDATE',[id]);
    if(!before) fail('Bus layout not found.',404,'not_found');
    await query(connection,'UPDATE trips SET active=0, deleted_at=COALESCE(deleted_at,NOW()) WHERE bus_id=?',[id]);
    await query(connection,"UPDATE buses SET deleted_at=NOW() WHERE id=?",[id]);
    await audit('bus.deleted','bus',id,before,{deleted:true,historyRetained:true},user.id,req,connection);
  });
}

export async function deleteTrip(id, user, req) {
  return transaction(async connection=>{
    const [before]=await query(connection,'SELECT * FROM trips WHERE id=? AND deleted_at IS NULL FOR UPDATE',[id]);
    if(!before) fail('Schedule not found.',404,'not_found');
    await query(connection,'UPDATE trips SET active=0, deleted_at=NOW() WHERE id=?',[id]);
    await audit('trip.deleted','trip',id,before,{deleted:true,historyRetained:true},user.id,req,connection);
  });
}

export async function deleteCrew(id, user, req) {
  const [before]=await query(pool,'SELECT * FROM crew WHERE id=? AND deleted_at IS NULL',[id]);
  if(!before) fail('Staff member not found.',404,'not_found');
  await query(pool,'UPDATE crew SET deleted_at=NOW() WHERE id=?',[id]);
  await audit('crew.deleted','crew',id,before,{deleted:true},user.id,req);
}

export async function assignDeparture(id, data, user, req) {
  requireFields(data, ['date', 'busId', 'driver', 'attendant', 'departure', 'platform', 'expected']);
  const date = String(data.date);
  if (!validDate(date) || date < pakistanDate()) fail('Choose today or a future travel date.', 422, 'validation_error');
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(data.departure)) fail('Choose a valid departure time.', 422, 'validation_error');
  for (const [field, limit] of [['driver',120],['attendant',120],['platform',30]]) {
    if (typeof data[field] !== 'string' || data[field].trim().length > limit) fail(`Invalid ${field}.`, 422, 'validation_error');
  }
  return transaction(async connection => {
    const [trip] = await query(connection, 'SELECT * FROM trips WHERE id = ? FOR UPDATE', [id]);
    if (!trip || !trip.active || !parseJson(trip.service_days).includes(weekday(date))) fail('This schedule is unavailable on that date.', 409, 'departure_unavailable');
    const run = await ensureRun(connection, trip, date);
    if (!['Scheduled','Boarding'].includes(run.status)) fail('A departed or closed trip cannot be reassigned.', 409, 'departure_closed');
    const current = {busId:run.bus_id,driver:run.driver,attendant:run.attendant,departure:run.snapshot.departure,platform:run.platform};
    if (Object.keys(current).some(key => data.expected?.[key] !== current[key])) fail('This departure was changed by another operator. Refresh and try again.',409,'assignment_changed');
    const next = {busId:String(data.busId),driver:data.driver.trim(),attendant:data.attendant.trim(),departure:data.departure,platform:data.platform.trim()};
    await query(connection, 'SELECT id FROM buses WHERE id IN (?, ?) ORDER BY id FOR UPDATE', [run.bus_id,next.busId]);
    const bus = (await fetchBuses(false,connection)).find(item => item.id === next.busId);
    if (!bus || ['Maintenance','Retired'].includes(bus.status)) fail('Choose a ready bus.',409,'bus_unavailable');
    await query(connection,'SELECT id FROM crew WHERE name IN (?, ?, ?, ?) ORDER BY id FOR UPDATE',[run.driver,run.attendant,next.driver,next.attendant]);
    const crew = await fetchCrew(connection);
    for (const [field,role] of [['driver','Driver'],['attendant','Female attendant']]) {
      if (next[field] !== current[field] && !crew.some(person => person.name === next[field] && person.role === role && person.status !== 'Off duty')) fail(`Choose an available ${field} from Crew.`,422,'crew_unavailable');
    }
    const conflict = await query(connection, `SELECT id FROM trip_runs WHERE id <> ? AND status IN ('Scheduled','Boarding','Departed')
      AND (bus_id = ? OR (?<>'' AND driver = ?) OR (?<>'' AND attendant = ?)) AND
      (service_date = ? AND JSON_UNQUOTE(JSON_EXTRACT(snapshot,'$.departure')) = ?) LIMIT 1 FOR UPDATE`,
      [run.id,next.busId,next.driver,next.driver,next.attendant,next.attendant,date,next.departure]);
    if (conflict.length) fail('The bus or crew is assigned to another departure. Choose another assignment.',409,'assignment_in_use');
    const planned = await fetchTrips(false,connection);
    const datedRuns = await fetchTripRuns(date,connection);
    if (planned.some(other => {
      if (other.id === id || !other.active || !other.days.includes(weekday(date))) return false;
      const dated = datedRuns.find(item => item.tripId === other.id);
      if (dated) return false; // Existing runs were checked above, including closed records.
      return other.departure === next.departure && (other.busId === next.busId || other.driver === next.driver || other.attendant === next.attendant);
    })) fail('The bus or crew already has a scheduled trip at this time.',409,'roster_conflict');
    const activeBookings = await query(connection,"SELECT id FROM bookings WHERE trip_run_id = ? AND booking_status IN ('Confirmed','Reserved') FOR UPDATE",[run.id]);
    const seats = await query(connection,'SELECT MAX(seat_number) seat FROM booking_seats WHERE trip_run_id = ? AND active = 1',[run.id]);
    if (Number(seats[0]?.seat || 0) > bus.seats) fail('This bus is too small for the seats already sold or held. Choose a larger bus.',409,'seats_in_use');
    const snapshot = {...run.snapshot, departure:next.departure, bus};
    await query(connection,'UPDATE trip_runs SET bus_id = ?, driver = ?, attendant = ?, platform = ?, snapshot = ? WHERE id = ?',
      [next.busId,next.driver,next.attendant,next.platform,JSON.stringify(snapshot),run.id]);
    for (const booking of activeBookings) {
      await query(connection,'UPDATE bookings SET bus_registration = ?, service = ?, travel_time = ?, driver = ?, attendant = ? WHERE id = ?',
        [bus.registration,bus.service,next.departure,next.driver,next.attendant,booking.id]);
    }
    const after = (await fetchTripRuns(date,connection)).find(item => item.id === run.id);
    await audit('trip.assignment_changed','trip_run',run.id,current,{...next,affectedBookings:activeBookings.map(item=>item.id)},user.id,req,connection);
    return after;
  });
}

export async function transitionTrip(id, data, user, req) {
  requireFields(data,["action","date"]);
  const action=allowed(data.action,['boarding','pause','resume','depart','reopen','close-sales'],'action');
  const date=String(data.date), notes=String(data.notes||'').trim().slice(0,2000);
  if(!validDate(date)) fail('Choose a valid travel date.',422,'validation_error');
  return transaction(async connection=>{
    const [trip]=await query(connection,'SELECT * FROM trips WHERE id=? FOR UPDATE',[id]);
    if(!trip) fail('Schedule not found.',404,'not_found');
    const run=await ensureRun(connection,trip,date);
    const [bus]=await query(connection,'SELECT * FROM buses WHERE id=? FOR UPDATE',[run.bus_id]);
    if(['pause','resume','boarding','depart','reopen'].includes(action) && (trip.deleted_at || !trip.active || !parseJson(trip.service_days).includes(weekday(date)))) fail('This schedule is deleted, paused or not running today.',409,'departure_unavailable');
    if(['boarding','depart','reopen'].includes(action) && date!==pakistanDate()) fail('Bus departure and sales overrides are only available for today.',409,'invalid_service_date');
    if(action==='pause'||action==='resume') {
      if(!['Scheduled','Boarding'].includes(run.status)||date<pakistanDate()) fail('This departure is closed.',409,'invalid_transition');
      await query(connection,'UPDATE trip_runs SET sales_paused=? WHERE id=?',[action==='pause'?1:0,run.id]);
    } else if(action==='reopen'||action==='close-sales') {
      if(run.status!=='Departed') fail('Only a departed bus can use the counter sales override.',409,'invalid_transition');
      if(action==='reopen' && (data.confirm!==true||notes.length<5)) fail('Confirm reopening and enter a reason (at least 5 characters).',422,'confirmation_required');
      await query(connection,'UPDATE trip_runs SET sales_override=? WHERE id=?',[action==='reopen'?1:0,run.id]);
    } else {
      if(!['Scheduled','Boarding'].includes(run.status)) fail('This bus is already closed.',409,'invalid_transition');
      if(!bus||bus.deleted_at||['Maintenance','Retired'].includes(bus.status)) fail('This bus layout is unavailable.',409,'bus_unavailable');
      if(action==='boarding') await query(connection,"UPDATE trip_runs SET status='Boarding' WHERE id=?",[run.id]);
      else {
        const holds=await query(connection,"SELECT id FROM bookings WHERE trip_run_id=? AND booking_status='Reserved' FOR UPDATE",[run.id]);
        if(holds.length && !(data.confirm===true && data.resolveReservations===true)) fail('Collect or cancel remaining reservations, or confirm their release when closing.',409,'unpaid_reservations');
        for(const hold of holds){
          await query(connection,"UPDATE bookings SET booking_status='Cancelled' WHERE id=?",[hold.id]);
          await query(connection,'UPDATE booking_seats SET active=0 WHERE booking_id=?',[hold.id]);
          await audit('reservation.released_on_departure','booking',hold.id,null,{reason:notes||'Bus departed'},user.id,req,connection);
        }
        const ids=await query(connection,"SELECT id FROM bookings WHERE trip_run_id=? AND booking_status='Confirmed'",[run.id]);
        const passengers=[];for(const item of ids)passengers.push(await fetchBooking(item.id,connection));
        await query(connection,"UPDATE trip_runs SET status='Departed',departed_at=NOW(),sales_paused=0,sales_override=0,snapshot=? WHERE id=?",[JSON.stringify({...run.snapshot,passengers}),run.id]);
        await query(connection,'UPDATE trips SET last_departed_at=NOW() WHERE id=?',[id]);

      }
    }
    const after=(await fetchTripRuns(date,connection)).find(r=>r.id===run.id);
    await audit(`trip.${action}`,'trip_run',run.id,run,{...after,operatorReason:notes},user.id,req,connection);
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
  const role = allowed(String(data.role), ["manager", "counter", "dispatcher", "finance"], "role");
  const email = String(data.email).trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail("Enter a valid email address.", 422, "validation_error");
  const username = String(data.username).trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,40}$/.test(username)) {
    fail("Username must be 3-40 characters using letters, numbers, dots, dashes or underscores.", 422, "validation_error");
  }
  const password = String(data.password);
  if (password.length < 12 || Buffer.byteLength(password) > 72 || !/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/\d/.test(password) || !/[^A-Za-z0-9]/.test(password)) {
    fail("Use at least 12 characters with upper-case, lower-case, number and symbol.", 422, "weak_password");
  }
  const result = await query(pool,
    "INSERT INTO users (name, email, username, password_hash, role, force_password_change) VALUES (?, ?, ?, ?, ?, 1)",
    [String(data.name).trim(), email, username, await bcrypt.hash(password, 12), role]);
  const created = (await fetchUsers()).find((item) => item.id === Number(result.insertId));
  await audit("user.created", "user", result.insertId, null, created, user.id, req);
  return created;
}

// Date-specific counter edits. The recurring timetable remains the starting point.
export async function saveCounterDeparture(id, data, user, req) {
  if(data.voucher&&user.role==='dispatcher') fail('Voucher changes require counter or management access.',403,'forbidden');
  const date = String(data.date || '');
  if (!validDate(date)) fail('Choose a valid travel date.', 422, 'validation_error');
  const registration = String(data.registration || '').trim().toUpperCase();
  if (registration.length > 30) fail('Enter a bus number (up to 30 characters).', 422, 'validation_error');
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(data.departure)) fail('Choose a valid departure time.', 422, 'validation_error');
  return transaction(async connection => {
    const [trip] = await query(connection, 'SELECT * FROM trips WHERE id = ? FOR UPDATE', [id]);
    if (!trip) fail('Schedule not found.', 404, 'not_found');
    const run = await ensureRun(connection, trip, date);
    const previous = run.snapshot.voucher || null;
    const current = {registration: run.snapshot.bus.isTemplate?'':run.snapshot.bus.registration, departure: run.snapshot.departure, revision: previous?.revision || ''};
    if (Object.keys(current).some(key => current[key] !== (key==='registration'&&run.snapshot.bus.isTemplate&&data.expected?.[key]===run.snapshot.bus.registration?'':data.expected?.[key]))) fail('Another operator changed this departure. Refresh before saving.', 409, 'assignment_changed');
    if (data.expected?.busId !== undefined && data.expected.busId !== run.bus_id) fail('Another operator changed this bus. Refresh before saving.',409,'assignment_changed');
    const fleet = await fetchBuses(false, connection);
    const layout = data.layoutBusId ? fleet.find(item => item.id === data.layoutBusId) : run.snapshot.bus;
    if (!layout || layout.deleted || (data.layoutBusId && layout.status === 'Retired')) fail('Choose an available bus type.',422,'validation_error');
    const layoutChanged = layout.seats !== run.snapshot.bus.seats || layout.service !== run.snapshot.bus.service || JSON.stringify(layout.seatClasses||[])!==JSON.stringify(run.snapshot.bus.seatClasses||[]);
    const changed = registration !== current.registration || data.departure !== current.departure || layoutChanged || (layout.layoutId||layout.id)!==(run.snapshot.bus.layoutId||run.snapshot.bus.id);
    if (layoutChanged) {
      const active = await query(connection, "SELECT id FROM bookings WHERE trip_run_id=? AND booking_status IN ('Reserved','Confirmed') LIMIT 1 FOR UPDATE", [run.id]);
      if (active.length) fail('This departure already has booked or reserved seats. Keep its seating plan, or release those seats before changing bus type.',409,'layout_in_use');
    }
    const voucherVehicleAssignment=data.voucher && run.snapshot.bus.isTemplate && !layoutChanged && data.departure===current.departure && ['Departed','Returned'].includes(run.status);
    if (changed && !voucherVehicleAssignment && (trip.deleted_at || date < pakistanDate() || !['Scheduled','Boarding'].includes(run.status))) fail('Bus and time cannot be changed after departure.', 409, 'departure_closed');
    const layoutId=layout.layoutId||layout.id;
    let bus={...layout,layoutId,registration:registration||layout.registration,isTemplate:!registration};
    if(registration) {
      let candidate=fleet.find(item=>!item.isTemplate&&item.registration.toUpperCase()===registration);
      if(candidate?.deleted||['Maintenance','Retired'].includes(candidate?.status)) fail('This vehicle is unavailable.',409,'bus_unavailable');
      if(!candidate) {
        const busId=uuid('bus-');
        await query(connection,`INSERT INTO buses(id,registration,service,seats,model,model_year,status,next_service) VALUES (?,?,?,?,?,?,'Ready','Not scheduled')`,[busId,registration,layout.service,layout.seats,layout.model,Number(date.slice(0,4))]);
        candidate={...layout,id:busId};
      }
      bus={...bus,id:candidate.id,isTemplate:false};
    }
    const route=(await fetchRoutes(false,connection)).find(r=>r.id===trip.route_id)||run.snapshot.route;
    const snapshot = {...run.snapshot,route,bus,departure:data.departure};
    let driver = run.driver, attendant = run.attendant;
    if (data.voucher) {
      if(!registration) fail('Vehicle number is required to save a voucher.',422,'vehicle_required');
      const draft = data.voucher;
      driver = String(draft.driver || '').trim(); attendant = String(draft.attendant || '').trim();
      if (driver.length > 120 || attendant.length > 120) fail('Crew names are too long.',422,'validation_error');
      const amounts = {};
      for (const field of ['commissionRate','manualCommission','refreshments','terminalExpense','toll','misc','paidToDriver']) {
        amounts[field] = decimal(draft[field] ?? 0,field);
        if (amounts[field] > (field === 'commissionRate' ? 100 : 10000000)) fail(`Invalid ${field}.`,422,'validation_error');
      }
      const managedBus=fleet.find(b=>b.id===(bus.layoutId||bus.id))||bus;
      const policy=commissionPolicy(route,managedBus);
      if(policy.fixed && (amounts.commissionRate!==policy.rate||amounts.manualCommission!==0)) fail('This commission is fixed in management. Refresh the voucher before saving.',409,'commission_fixed');
      if(policy.fixed) {amounts.commissionRate=policy.rate;amounts.manualCommission=0;}
      const [sales] = await query(connection, `SELECT COALESCE(SUM(paid),0) gross FROM bookings WHERE trip_run_id = ?`,[run.id]);
      const [refunds] = await query(connection, `SELECT COALESCE(SUM(r.amount),0) refunded FROM refunds r JOIN bookings b ON b.id=r.booking_id WHERE b.trip_run_id=?`,[run.id]);
      const basis = Math.round((Number(sales.gross)-Number(refunds.refunded))*100)/100;
      const commission = Math.round(basis*amounts.commissionRate)/100 + amounts.manualCommission;
      const deductions = Math.round((commission+amounts.refreshments+amounts.terminalExpense+amounts.toll+amounts.misc)*100)/100;
      const reference = `VOUCHER-${run.id}`;
      const description = `Departure voucher · ${registration} · ${date} ${data.departure}`;
      let expenseId = previous?.expenseId;
      if (expenseId) {
        await query(connection,'UPDATE expenses SET amount=?, description=?, notes=? WHERE id=?',[deductions,description,JSON.stringify(amounts),expenseId]);
      } else {
        const result = await query(connection,`INSERT INTO expenses (expense_date,category,description,amount,payment_method,reference,notes,created_by) VALUES (?,'Terminal',?,?,'Cash',?,?,?)`,[date,description,deductions,reference,JSON.stringify(amounts),user.id]);
        expenseId = Number(result.insertId);
      }
      const delta = Math.round((deductions-(previous?.deductions || 0))*100)/100;
      if (delta !== 0) await query(connection,`INSERT INTO financial_transactions (transaction_type,amount,payment_method,reference,description,created_by) VALUES ('expense',?,'Cash',?,?,?)`,[-delta,reference,description,user.id]);
      snapshot.voucher = {...amounts,driver,attendant,commission,deductions,basis,totalRemaining:Math.round((basis-deductions)*100)/100,expenseId,revision:uuid(),savedAt:isoDateTime(sqlDateTime()),savedBy:user.name};
    }
    await query(connection,'UPDATE trip_runs SET bus_id=?, driver=?, attendant=?, snapshot=? WHERE id=?',[bus.id,driver,attendant,JSON.stringify(snapshot),run.id]);
    await query(connection,`UPDATE bookings SET bus_registration=?,service=?,travel_time=?,driver=?,attendant=? WHERE trip_run_id=? AND booking_status IN ('Reserved','Confirmed')`,[bus.isTemplate?'To be assigned':bus.registration,bus.service,data.departure,driver,attendant,run.id]);
    const after = (await fetchTripRuns(date,connection)).find(item=>item.id===run.id);
    await audit(data.voucher ? 'voucher.saved' : 'departure.updated','trip_run',run.id,{...current,voucher:previous},after,user.id,req,connection);
    return after;
  });
}
