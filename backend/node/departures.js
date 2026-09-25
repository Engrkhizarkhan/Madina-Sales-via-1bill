import { fail, parseJson, pakistanDate } from './helpers.js';
import { fetchBuses, fetchRoutes } from './repository.js';

export async function ensureRun(connection, trip, date) {
  const id = `${trip.id}-${date}-run-1`;
  const [existing] = await connection.execute('SELECT * FROM trip_runs WHERE id = ? FOR UPDATE', [id]);
  if (existing.length) return { ...existing[0], snapshot: parseJson(existing[0].snapshot, null) };
  const bus = (await fetchBuses(false, connection)).find((item) => item.id === trip.bus_id);
  const route = (await fetchRoutes(false, connection)).find((item) => item.id === trip.route_id);
  if (!bus || !route) fail('The bus or route is unavailable.', 409, 'departure_unavailable');
  const snapshot = { routeId: route.id, departure: String(trip.departure).slice(0, 5), arrival: String(trip.arrival).slice(0, 5), bus, route };
  await connection.execute(`INSERT INTO trip_runs
    (id, trip_id, service_date, run_number, bus_id, driver, attendant, platform, status, notes, snapshot)
    VALUES (?, ?, ?, 1, ?, ?, ?, ?, 'Scheduled', '', ?)`,
  [id, trip.id, date, bus.id, trip.driver, trip.attendant, trip.platform, JSON.stringify(snapshot)]);
  const [records] = await connection.execute('SELECT * FROM trip_runs WHERE id = ?', [id]);
  return { ...records[0], snapshot };
}

export async function assertSaleOpen(connection, run, date, isPublic = false) {
  if (date < pakistanDate()) fail('This travel date has passed. Cancel the reservation and book the correct date.', 409, 'departure_unavailable');
  const [buses] = await connection.execute('SELECT status FROM buses WHERE id = ? FOR UPDATE', [run.bus_id]);
  if (['Departed', 'Returned', 'Cancelled'].includes(run.status) || !buses.length || ['Maintenance', 'Retired'].includes(buses[0].status)) {
    fail('This departure is closed or its bus is unavailable.', 409, 'departure_unavailable');
  }
  // Counter staff may issue last-minute tickets while the actual bus is still boarding.
  if (isPublic && new Date(`${date}T${run.snapshot.departure}:00+05:00`) <= new Date()) {
    fail('Online booking has closed for this departure. Contact the terminal.', 409, 'departure_unavailable');
  }
}
