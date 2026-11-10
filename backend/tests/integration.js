import "dotenv/config";
import bcrypt from "bcryptjs";
import { pakistanDate } from "../node/helpers.js";
import { config } from "../node/config.js";
import { pool, closePool } from "../node/db.js";

if (!/test|qa/i.test(config.db.database)) throw new Error("Use an isolated test database.");
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
const assignmentCrewIds = [];
const rosterCrewIds = [];
let replacementBusId = null;

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
  const date = new Date(`${pakistanDate()}T00:00:00Z`);
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
  for (let attempt = 0; attempt < 7; attempt++) {
    check((await request('POST','/auth/login',{identity:testAdminUsername,password:'wrong'})).status === 401, `mistyped password ${attempt+1} returns an error without locking the account`);
  }
  await pool.execute('UPDATE users SET locked_until = DATE_ADD(NOW(), INTERVAL 1 DAY), failed_login_count = 8 WHERE id = ?', [testAdminId]);
  const login = await request("POST", "/auth/login", { identity: testAdminUsername, password: testAdminPassword });
  check(login.status === 200 && login.body.csrfToken, "Node.js login creates a MySQL-backed session");
  const csrf = login.body.csrfToken;
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
  for (const [role,name] of [['Driver',tripResult.body.trip.driver],['Female attendant',tripResult.body.trip.attendant]]) {
    const person = await request('POST','/crew/new',{name,role,phone:'03001112222',cnic:`${String(Date.now()).slice(-5)}-${role === 'Driver' ? '3333333' : '4444444'}-1`,license:'QA',duty:'Available',status:'Available',initials:'QA'},csrf);
    rosterCrewIds.push(person.body.person.id);
  }
  const replacement = await request('POST','/buses/new',{...busResult.body.bus,registration:`QA-SPARE-${Date.now()}`,seats:40},csrf);
  replacementBusId = replacement.body.bus.id;
  for (const role of ['Driver','Female attendant']) {
    const person = await request('POST','/crew/new',{name:`QA Replacement ${role} ${Date.now()}`,role,phone:'03001112222',cnic:`${String(Date.now()).slice(-5)}-${role === 'Driver' ? '1234567' : '7654321'}-1`,license:'QA',duty:'Available',status:'Available',initials:'QA'},csrf);
    assignmentCrewIds.push(person.body.person.id);
  }
  const publicResult = await request("GET", "/public/bootstrap");
  check(publicResult.status === 200 && publicResult.body.trips.length > 0, "public timetable is available without exposing staff data");
  const publicTrip = publicResult.body.trips.find((item) => item.id === createdTripId);
  const publicBus = publicResult.body.fleet.find((item) => item.id === publicTrip.busId);
  const publicDate = nextServiceDate(publicTrip.days);
  const publicOccupied = publicResult.body.occupancy
    .filter((item) => item.tripRunId === `${publicTrip.id}-${publicDate}-run-1`)
    .flatMap((item) => item.seats);
  const publicSeat = Array.from({ length: publicBus.seats }, (_, index) => publicBus.seats - index)
    .find((number) => !publicOccupied.includes(number));
  if (!publicSeat) throw new Error("No public reservation test seat is available.");
  const publicPayload = {
    passenger: "Public Reservation QA", phone: "03001112222", cnic: "17301-7654321-9",
    tripId: publicTrip.id, date: publicDate, seats: [publicSeat], bookingStatus: "Confirmed",
    paid: 500, paymentReference: "CLIENT-FORGED",
  };
  const publicReservation = await request("POST", "/public/bookings", publicPayload, undefined, false);
  const confirmation = publicReservation.body.bookings?.[0];
  check(publicReservation.status === 201 && confirmation?.ticketNo.startsWith("RS-") &&
    confirmation.expiresAt && !("cnic" in confirmation) && !("phone" in confirmation),
    "public checkout returns an expiring reservation confirmation with no ID or phone");
  const lookup = (reference, phone) => request("POST", "/public/ticket-lookup", { reference, phone }, undefined, false);
  const foundHold = await lookup(confirmation.ticketNo.toLowerCase(), "+92 300 1112222");
  check(foundHold.status === 200 && foundHold.body.journey.status === "Reserved" &&
    foundHold.body.journey.date === publicDate && foundHold.body.journey.time === publicTrip.departure &&
    foundHold.body.journey.seats[0] === publicSeat && foundHold.body.journey.expiresAt === confirmation.expiresAt,
    "lookup accepts formatted phone and returns the reserved journey");
  check(!["id", "cnic", "phone", "passenger", "paymentReference"].some(field => field in foundHold.body.journey),
    "public lookup excludes personal and internal booking fields");
  const wrongPhone = await lookup(confirmation.ticketNo, "03009998888");
  const unknownReference = await lookup("RS-UNKNOWN-REFERENCE", publicPayload.phone);
  check(wrongPhone.status === 404 && unknownReference.status === 404 &&
    wrongPhone.body.error.message === unknownReference.body.error.message, "lookup conceals unmatched references");
  const [held] = await pool.execute("SELECT id, booking_status, payment_status, paid, payment_reference, cnic FROM bookings WHERE ticket_no = ?", [confirmation.ticketNo]);
  createdBookings.push(held[0].id);
  check(held[0].booking_status === "Reserved" && held[0].payment_status === "Unpaid" &&
    Number(held[0].paid) === 0 && !held[0].payment_reference && !held[0].cnic,
    "server ignores forged payment and identity fields for public reservations");
  const [ledger] = await pool.execute("SELECT COUNT(*) count FROM financial_transactions WHERE booking_id = ?", [held[0].id]);
  check(Number(ledger[0].count) === 0, "unpaid web hold writes no ledger transaction");
  check((await request("POST", "/public/bookings", publicPayload, undefined, false)).status === 409,
    "an unpaid web hold protects the selected seat");
  await pool.execute("UPDATE bookings SET expires_at = DATE_SUB(NOW(), INTERVAL 1 MINUTE) WHERE id = ?", [held[0].id]);
  check((await lookup(confirmation.ticketNo, publicPayload.phone)).body.journey?.status === "Expired",
    "lookup shows an expired reservation before cleanup");
  const renewed = await request("POST", "/public/bookings", publicPayload, undefined, false);
  check(renewed.status === 201, "an expired web hold releases its seat");
  const [[replacementHold]] = await pool.execute("SELECT id FROM bookings WHERE ticket_no = ?", [renewed.body.bookings[0].ticketNo]);
  createdBookings.push(replacementHold.id);
  check((await request("POST", `/bookings/${replacementHold.id}/cancel`, {}, csrf)).status === 200,
    "counter staff can cancel a web reservation");
  check((await request("POST", "/auth/login", { identity: "not-a-user", password: "wrong" })).status === 401, "invalid staff login is rejected");

  const bootstrap = await request("GET", "/admin/bootstrap");
  check(bootstrap.status === 200 && bootstrap.body.routes.length > 0, "authenticated operations data loads");
  const trip = bootstrap.body.trips.find((item) => item.id === createdTripId);
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
  const assignmentCrew = (await request('GET','/admin/bootstrap')).body.crew.filter(person=>assignmentCrewIds.includes(person.id));
  const originalAssignment = {busId:createdBusId,driver:trip.driver,attendant:trip.attendant,departure:trip.departure,platform:trip.platform};
  const changedAssignment = {...originalAssignment,busId:replacementBusId,driver:assignmentCrew.find(person=>person.role==='Driver').name,attendant:assignmentCrew.find(person=>person.role==='Female attendant').name,departure:'23:45',platform:'QA-2'};
  const assignment = await request('PUT',`/trips/${createdTripId}/assignment`,{date,...changedAssignment,expected:originalAssignment},csrf);
  check(assignment.status === 200 && assignment.body.trip.busId === replacementBusId && assignment.body.trip.driver === changedAssignment.driver, 'counter departure assignment saves bus, driver, attendant, time and platform for one date');
  const afterAssignment = await request('GET','/admin/bootstrap');
  const amendedTicket = afterAssignment.body.bookings.find(item=>item.id===booking.id);
  check(amendedTicket.bus === replacement.body.bus.registration && amendedTicket.time === '23:45' && amendedTicket.driver === changedAssignment.driver,'existing active tickets follow the dated assignment');
  check(afterAssignment.body.trips.find(item=>item.id===createdTripId).driver === trip.driver && afterAssignment.body.trips.find(item=>item.id===createdTripId).busId === createdBusId,'recurring roster defaults are not modified by a counter override');
  check((await request('PUT',`/trips/${createdTripId}/assignment`,{date,...originalAssignment,expected:originalAssignment},csrf)).status === 409,'stale counter edits cannot overwrite another operator');
  await request('POST',`/buses/${createdBusId}`,{...busResult.body.bus,status:'Maintenance'},csrf);
  const replacementSale = await request('POST','/bookings',{...bookingRequest,seats:[1],bookingStatus:'Reserved',paymentMethod:'Cash'},csrf);
  check(replacementSale.status === 201,'replacement bus permits sales even when the default bus is in maintenance');
  createdBookings.push(replacementSale.body.booking.id);
  await request('POST',`/bookings/${replacementSale.body.booking.id}/cancel`,{},csrf);
  check((await request('PUT',`/trips/${createdTripId}/assignment`,{date,...originalAssignment,expected:changedAssignment},csrf)).status === 409,'maintenance bus cannot be selected as a replacement');
  const smallerBus = await request('POST',`/buses/${createdBusId}`,{...busResult.body.bus,status:'Ready',seats:30},csrf);
  check(smallerBus.status === 200, 'test replacement bus capacity adjusted');
  check((await request('PUT',`/trips/${createdTripId}/assignment`,{date,...originalAssignment,expected:changedAssignment},csrf)).status === 409,'replacement bus cannot remove sold seat numbers');
  await request('POST',`/buses/${createdBusId}`,busResult.body.bus,csrf);
  check((await request('PUT',`/trips/${createdTripId}/assignment`,{date,...originalAssignment,expected:changedAssignment},csrf)).status === 200,'operator can restore original assignment while departure is open');
  check((await request("POST", "/bookings", { ...bookingRequest, bookingStatus: "Confirmed", paymentMethod: "Bank transfer", paymentReference: "", discount: 0 }, csrf)).status === 422,
    "counter bank transfer requires a payment reference");
  check((await request("POST", "/bookings", { ...bookingRequest, bookingStatus: "Confirmed",
    paymentMethod: "Card", paymentReference: "CARD-QA" }, csrf)).status === 422, "card payments cannot be created");
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
  if (confirmed.status !== 200 || confirmed.body.booking?.bookingStatus !== "Confirmed") {
    throw new Error(`reservation payment creates a confirmed ticket (${confirmed.status}: ${confirmed.body.error?.code || "unexpected response"})`);
  }
  check(true, "reservation payment creates a confirmed ticket");
  const issuedRef = confirmed.body.booking.ticketNo;
  const foundTicket = await lookup(issuedRef, bookingRequest.phone);
  const foundOriginal = await lookup(reservation.body.booking.ticketNo, bookingRequest.phone);
  check(foundTicket.status === 200 && foundTicket.body.journey.status === "Confirmed" &&
    foundOriginal.status === 200 && foundOriginal.body.journey.reference === issuedRef,
    "both the issued ticket and original reservation reference find the confirmed journey");
  const retainedRefund = await request('POST', `/bookings/${reservation.body.booking.id}/refunds`, {amount:100,method:'Cash',reason:'Passenger request',releaseSeats:true,notes:'Passenger cancellation with retained amount'},csrf);
  check(retainedRefund.status === 201 && retainedRefund.body.booking.bookingStatus === 'Cancelled' && retainedRefund.body.booking.paymentStatus === 'Partially refunded', 'partial refund can explicitly cancel ticket while retaining the remainder');
  const contenders = await Promise.all([1,2].map(() => request('POST','/bookings',{...bookingRequest,bookingStatus:'Reserved',paymentMethod:'Cash'},csrf)));
  for (const result of contenders) if (result.status === 201) createdBookings.push(result.body.booking.id);
  check(contenders.filter((result) => result.status === 201).length === 1 && contenders.filter((result) => result.status === 409).length === 1, 'released seat is available but simultaneous attempts cannot double-book it');
  check((await request('POST', `/trips/${createdTripId}`, {...tripResult.body.trip,departure:'23:40'},csrf)).status === 200, 'recurring schedule can be edited while dated passenger assignments are preserved');
  const preserved=(await request('GET','/admin/bootstrap')).body.bookings.find(b=>b.id===booking.id);
  check(preserved.time===booking.time,'editing roster does not rewrite the existing dated ticket time');

  const locked = await request("GET", "/expenses");
  check(locked.status === 403 && locked.body.error.code === "finance_locked", "finance remains locked by default");
  const financePin = "017395";
  check((await request("GET", "/finance/status")).body.pinConfigured === false, "finance starts without a PIN");
  check((await request("POST", "/auth/finance-unlock", { pin: financePin }, csrf)).status === 409, "finance must be configured in Settings");
  check((await request("PUT", "/finance/pin", { pin: financePin, currentPassword: "wrong-password" }, csrf)).status === 422,
    "changing the finance PIN requires the administrator password");
  check((await request("PUT", "/finance/pin", { pin: financePin, currentPassword: testAdminPassword }, csrf)).status === 200,
    "administrator sets the finance PIN");
  check((await request("POST", "/auth/finance-unlock", { pin: "908769" }, csrf)).status === 422, "wrong finance PIN is rejected");
  const unlocked = await request("POST", "/auth/finance-unlock", { pin: financePin }, csrf);
  check(unlocked.status === 200 && unlocked.body.unlocked && unlocked.body.expiresIn === 900, "finance PIN unlocks access for 15 minutes");
  const newFinancePin = "046178";
  check((await request("PUT", "/finance/pin", { pin: newFinancePin, currentPassword: testAdminPassword }, csrf)).status === 200 &&
    (await request("GET", "/expenses")).status === 403, "PIN changes revoke existing finance unlocks");
  check((await request("POST", "/auth/finance-unlock", { pin: financePin }, csrf)).status === 422, "old finance PIN no longer works");
  check((await request("POST", "/auth/finance-unlock", { pin: newFinancePin }, csrf)).status === 200, "updated PIN unlocks finance");

  createdExpenseReference = `NODE-EXP-${Date.now()}`;
  const expense = await request("POST", "/expenses", { date: new Date().toISOString().slice(0, 10), category: "Terminal", description: "Automated Node expense", amount: 100, paymentMethod: "Cash", reference: createdExpenseReference, notes: "Cleanup expected" }, csrf);
  if (expense.status !== 201 || Number(expense.body.expense?.amount) !== 100) {
    throw new Error(`Node.js records audited expenses (${expense.status}: ${expense.body.error?.code || "unexpected response"})`);
  }
  check(true, "Node.js records audited expenses");
  createdExpenseId = Number(expense.body.expense.id);
  check((await request("GET", "/expenses")).status === 200, "unlocked expense history loads");
  check((await request("POST", "/shifts/open", { counterName: "Old flow", openingCash: 0 }, csrf)).status === 404, "shift endpoints are removed");

  const runDate = pakistanDate();
  const tomorrow = nextServiceDate(tripResult.body.trip.days);
  check((await request("POST", `/trips/${createdTripId}/transition`, { action: "boarding", date: tomorrow }, csrf)).status === 409, "future roster cannot board early");
  await request("POST", `/buses/${createdBusId}`, {...busResult.body.bus, status: "Maintenance"}, csrf);
  check((await request("POST", `/trips/${createdTripId}/transition`, { action: "boarding", date: runDate }, csrf)).status === 409, "maintenance bus cannot board");
  await request("POST", `/buses/${createdBusId}`, {...busResult.body.bus, status: "Ready"}, csrf);
  const boarding = await request("POST", `/trips/${createdTripId}/transition`, { action: "boarding", date: runDate }, csrf);
  check(boarding.status === 200 && boarding.body.trip.status === "Boarding", "dated trip run can open boarding without changing future roster dates");
  const runList = await request("GET", `/trip-runs?date=${runDate}`);
  check(runList.status === 200 && runList.body.runs.some((run) => run.tripId === createdTripId && run.status === "Boarding"), "dated run state is persisted and queryable");
  const heldToday = await request("POST", "/bookings", {...bookingRequest, date: runDate, seats:[1], bookingStatus:"Reserved"}, csrf);
  check(heldToday.status === 201, "boarding departure accepts counter reservations");
  createdBookings.push(heldToday.body.booking.id);
  check((await request("POST", `/trips/${createdTripId}/transition`, {action:"depart",date:runDate},csrf)).status === 409, "departure requires operator to resolve unpaid reservations");
  const paidToday = await request("POST", `/bookings/${heldToday.body.booking.id}/confirm`, {paymentMethod:"Bank transfer",paymentReference:"QA-BANK"},csrf);
  check(paidToday.status === 200 && paidToday.body.booking.paymentMethod === "Bank transfer", "counter collects a reservation by verified bank reference");
  const departed = await request("POST", `/trips/${createdTripId}/transition`, {action:"depart",date:runDate},csrf);
  check(departed.status === 200 && departed.body.trip.departedAt && departed.body.trip.snapshot.passengers.length === 1, "departure records timestamp and immutable passenger manifest");
  check((await request('PUT',`/trips/${createdTripId}/assignment`,{date:runDate,...changedAssignment,expected:originalAssignment},csrf)).status === 409,'departed bus assignments cannot be rewritten');
  check((await request("POST", "/bookings", {...bookingRequest,date:runDate,seats:[2],bookingStatus:"Confirmed",paymentMethod:"Cash"},csrf)).status === 409,"departed bus cannot sell more seats");
  check((await request("POST", `/buses/${createdBusId}`, {...busResult.body.bus,status:"Ready"},csrf)).status === 200,"daily departures do not lock the bus setup");
  const refundAfterDeparture = await request("POST", `/bookings/${heldToday.body.booking.id}/refunds`, {amount:500,method:"Cash",reason:"Passenger request",notes:"QA retained history"},csrf);
  check(refundAfterDeparture.status === 201,"refund remains linked to original ticket after departure");
  const recorded = await request("GET", `/trip-runs?date=${runDate}`);
  const record = recorded.body.runs.find((run) => run.tripId === createdTripId);
  check(record.snapshot.passengers.length === 1 && record.snapshot.passengers[0].seats[0] === 1,"refund does not rewrite who travelled");
  const publicRuns = await request("GET", `/public/trip-runs?date=${runDate}`, undefined,undefined,false);
  check(!JSON.stringify(publicRuns.body).includes("Automated Node QA Passenger") && !JSON.stringify(publicRuns.body).includes("passengers"),"public departure feed does not expose passenger snapshots");
  const returned = await request("POST", `/trips/${createdTripId}/transition`, {action:"return",date:runDate,notes:"Arrived at terminal"},csrf);
  check(returned.status === 422,"return action is no longer part of the daily departure workflow");
  const refreshed = await request("GET", "/admin/bootstrap");
  check(refreshed.body.fleet.find((item) => item.id === createdBusId).status === "Ready","departure leaves the bus available for another day");
  check((await request("POST", `/trips/${createdTripId}/transition`, {action:"boarding",date:runDate},csrf)).status === 409,"closed departure cannot be accidentally reopened");

  const crewResult = await request("POST", "/crew/new", { name: "Automated Spare Crew", role: "Driver", phone: "03009999999", cnic: `${String(Date.now()).slice(-5)}-1234567-1`, license: "QA-HTV", duty: "Available", status: "Available", initials: "AC" }, csrf);
  createdCrewId = Number(crewResult.body.person.id);
  check(crewResult.status === 200, "crew member can be added");
  check((await request("DELETE", `/crew/${createdCrewId}`, undefined, csrf)).status === 200, "unassigned crew member can be deleted");

  check((await request("GET", "/audit")).body.events.length >= 5, "audit trail records sensitive operations");

  check((await request('DELETE',`/trips/${createdTripId}`,undefined,csrf)).status===200,'schedule with ticket and movement history can be deleted');
  const afterDelete=(await request('GET','/admin/bootstrap')).body;
  check(afterDelete.trips.find(t=>t.id===createdTripId).deleted&&afterDelete.bookings.some(b=>b.id===booking.id),'deleted schedule is hidden but ticket history is retained');
  check(!(await request('GET','/public/bootstrap')).body.trips.some(t=>t.id===createdTripId),'deleted schedule is removed from public availability');
  check((await request('POST','/bookings',{...bookingRequest,seats:[4]},csrf)).status===409,'deleted schedule rejects new sales');
  check((await request('DELETE',`/buses/${createdBusId}`,undefined,csrf)).status===200,'bus deletion archives referenced setup without destroying history');
  check((await request('DELETE',`/routes/${createdRouteId}`,undefined,csrf)).status===200,'route deletion archives referenced schedules and retains tickets');
  const qaUsername = `node-counter-${Date.now()}`;
  const qaPassword = "NodeCounter!2026";
  const staff = await request("POST", "/users", { name: "Automated Node Counter", username: qaUsername, role: "counter", password: qaPassword }, csrf);
  check(staff.status === 201 && staff.body.user.role === "counter" && !staff.body.user.forcePasswordChange &&
    !("email" in staff.body.user), "administrator creates a username-only staff account with a working password");
  createdUserId = Number(staff.body.user.id);
  const terminalAccess = await request("GET", "/users/terminal-access");
  check(terminalAccess.status === 200 && terminalAccess.body.terminals.length === 3, "admin can see the three terminal slots");
  check((await request("POST", "/auth/logout", {}, csrf)).status === 200, "logout invalidates Node.js session");
  cookie = "";
  check((await request("GET", "/admin/bootstrap")).status === 401, "logged-out session cannot access operations");

  const counterLogin = await request("POST", "/auth/login", { identity: qaUsername, password: qaPassword });
  check(counterLogin.status === 200, "new staff account authenticates through Node.js");
  const counterCsrf = counterLogin.body.csrfToken;
  check((await request('PUT',`/trips/${createdTripId}/assignment`,{date,...changedAssignment,expected:originalAssignment},counterCsrf)).status === 409,'counter cannot reassign a deleted schedule');
  const counterBootstrap = await request("GET", "/admin/bootstrap");
  check(counterBootstrap.status === 200 && counterBootstrap.body.users.length === 0, "staff cannot retrieve user administration records");
  check((await request("GET", "/finance/status")).status === 403, "staff cannot view finance");
  check((await request("POST", "/auth/finance-unlock", { password: qaPassword }, counterCsrf)).status === 403, "staff cannot unlock finance");
  check((await request("POST", `/bookings/${booking.id}/refunds`, { amount: 1, method: "Cash", reason: "Other" }, counterCsrf)).status === 422, "counter refunds still reject amounts exceeding the remaining balance");
  check((await request("GET", "/users/terminal-access")).status === 403, "staff cannot read terminal administration");
  check((await request("PUT", `/users/${createdUserId}`, { name: "Unauthorized", username: qaUsername, role: "manager" }, counterCsrf)).status === 403,
    "staff cannot edit their access role");
  const oldStaffCookie = cookie;
  cookie = "";
  const adminAgain = await request("POST", "/auth/login", { identity: testAdminUsername, password: testAdminPassword });
  const adminCookie = cookie;
  const adminCsrf = adminAgain.body.csrfToken;
  check((await request("DELETE", `/users/${testAdminId}`, undefined, adminCsrf)).status === 403, "main admin cannot be deleted through Staff access");
  const updatedUsername = `${qaUsername}-edit`;
  const updatedPassword = "NodeCounter!Updated2026";
  const edited = await request("PUT", `/users/${createdUserId}`, {
    name: "Updated Counter", username: updatedUsername, role: "manager", password: updatedPassword,
  }, adminCsrf);
  check(edited.status === 200 && edited.body.user.username === updatedUsername && edited.body.user.role === "manager",
    "admin can update staff details and reset the password");
  cookie = oldStaffCookie;
  check((await request("GET", "/auth/me")).status === 401, "staff edits invalidate the prior session");
  cookie = "";
  check((await request("POST", "/auth/login", { identity: updatedUsername, password: qaPassword })).status === 401, "previous staff password is rejected");
  check((await request("POST", "/auth/login", { identity: updatedUsername, password: updatedPassword })).status === 200,
    "updated staff password works without a reset screen");
  const updatedStaffCookie = cookie;
  cookie = adminCookie;
  check((await request("DELETE", `/users/${createdUserId}`, undefined, adminCsrf)).status === 200 &&
    !(await request("GET", "/admin/bootstrap")).body.users.some(user => user.id === createdUserId), "admin removes staff from the active list");
  cookie = updatedStaffCookie;
  check((await request("GET", "/auth/me")).status === 401, "deleted staff sessions stop working");
  cookie = "";
  check((await request("POST", "/auth/login", { identity: updatedUsername, password: updatedPassword })).status === 401, "deleted staff cannot sign in again");

  console.log(`\n${passed} Node.js integration checks passed.`);
} finally {
  try {
    if (createdExpenseId) {
      await pool.execute("DELETE FROM audit_logs WHERE entity_type = 'expense' AND entity_id = ?", [String(createdExpenseId)]);
      if (createdExpenseReference) await pool.execute("DELETE FROM financial_transactions WHERE transaction_type = 'expense' AND reference = ?", [createdExpenseReference]);
      await pool.execute("DELETE FROM expenses WHERE id = ?", [createdExpenseId]);
    }
    if (createdCrewId) await pool.execute("DELETE FROM crew WHERE id = ?", [createdCrewId]);
    if (createdBookings.length) {
      await pool.query("DELETE FROM audit_logs WHERE entity_type = 'booking' AND entity_id IN (?)", [createdBookings]);
      await pool.query("DELETE FROM financial_transactions WHERE booking_id IN (?)", [createdBookings]);
      await pool.query("DELETE FROM refunds WHERE booking_id IN (?)", [createdBookings]);
      await pool.query("DELETE FROM booking_seats WHERE booking_id IN (?)", [createdBookings]);
      await pool.query("DELETE FROM bookings WHERE id IN (?)", [createdBookings]);
    }
    if (createdTripId) {
      await pool.execute("DELETE FROM trip_runs WHERE trip_id = ?", [createdTripId]);
      await pool.execute("DELETE FROM trips WHERE id = ?", [createdTripId]);
    }
    if (createdBusId) await pool.execute("DELETE FROM buses WHERE id = ?", [createdBusId]);
    if (replacementBusId) await pool.execute('DELETE FROM buses WHERE id = ?', [replacementBusId]);
    for (const id of assignmentCrewIds) await pool.execute('DELETE FROM crew WHERE id = ?', [id]);
    for (const id of rosterCrewIds) await pool.execute('DELETE FROM crew WHERE id = ?', [id]);
    if (createdRouteId) await pool.execute("DELETE FROM routes WHERE id = ?", [createdRouteId]);
    await pool.execute("DELETE FROM audit_logs WHERE user_id = ? OR user_id = ?", [testAdminId, createdUserId]);
    if (createdUserId) {
      await pool.execute("DELETE FROM api_sessions WHERE user_id = ?", [createdUserId]);
      await pool.execute("DELETE FROM users WHERE id = ?", [createdUserId]);
    }
    if (testAdminId) {
      await pool.execute("DELETE FROM settings WHERE setting_key = 'finance_pin_hash' AND updated_by = ?", [testAdminId]);
      await pool.execute("DELETE FROM api_sessions WHERE user_id = ?", [testAdminId]);
      await pool.execute("DELETE FROM users WHERE id = ?", [testAdminId]);
    }
  } finally {
    await closePool();
  }
}
