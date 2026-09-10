<?php
declare(strict_types=1);

function inTransaction(callable $operation): mixed
{
    $pdo = db();
    $pdo->beginTransaction();
    try {
        $result = $operation($pdo);
        $pdo->commit();
        return $result;
    } catch (Throwable $error) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        throw $error;
    }
}

function createBooking(array $data, ?array $user, bool $public): array
{
    requireFields($data, ['passenger', 'phone', 'cnic', 'gender', 'tripId', 'date', 'seats']);
    if (!$public && (!$user || fetchCurrentShift((int)$user['id']) === null)) {
        fail('Open a counter shift before selling or reserving a ticket.', 409, 'shift_not_open');
    }
    $seats = array_values(array_unique(array_map('intval', is_array($data['seats']) ? $data['seats'] : [])));
    if ($seats === []) {
        fail('Select at least one seat.', 422, 'validation_error');
    }
    if ($public && count($seats) > 4) {
        fail('Online bookings are limited to four seats.', 422, 'validation_error');
    }
    foreach (['passenger' => 160, 'phone' => 30, 'cnic' => 50] as $field => $maximum) {
        if (strlen(trim((string)$data[$field])) > $maximum) {
            fail("{$field} is too long.", 422, 'validation_error');
        }
    }
    return inTransaction(function (PDO $pdo) use ($data, $user, $public, $seats): array {
        $stmt = $pdo->prepare(
            'SELECT t.*, r.origin, r.destination, r.fare route_fare, r.boarding_point, r.status route_status,
                    b.registration, b.service, b.seats capacity, b.status bus_status
             FROM trips t JOIN routes r ON r.id = t.route_id JOIN buses b ON b.id = t.bus_id
             WHERE t.id = ? FOR UPDATE'
        );
        $stmt->execute([(string)$data['tripId']]);
        $trip = $stmt->fetch();
        if (!$trip || !(bool)$trip['active'] || $trip['route_status'] !== 'Active' || in_array($trip['bus_status'], ['Maintenance', 'Retired'], true)) {
            fail('This departure is not available for booking.', 409, 'departure_unavailable');
        }
        $travelDate = (string)$data['date'];
        $date = DateTimeImmutable::createFromFormat('!Y-m-d', $travelDate);
        if (!$date || $date->format('Y-m-d') !== $travelDate || ($public && $travelDate < date('Y-m-d'))) {
            fail('Choose a valid travel date.', 422, 'validation_error');
        }
        $departureAt = DateTimeImmutable::createFromFormat('Y-m-d H:i:s', $travelDate . ' ' . $trip['departure']);
        if (!$departureAt || $departureAt <= new DateTimeImmutable()) {
            fail('This departure time has already passed.', 409, 'departure_unavailable');
        }
        $serviceDays = json_decode($trip['service_days'], true, 512, JSON_THROW_ON_ERROR);
        if (!in_array($date->format('D'), $serviceDays, true)) {
            fail('This trip does not run on the selected date.', 409, 'departure_unavailable');
        }
        foreach ($seats as $seat) {
            if ($seat < 1 || $seat > (int)$trip['capacity']) {
                fail('One or more selected seats are invalid.', 422, 'validation_error');
            }
        }
        $source = $public ? 'Public web' : 'Counter';
        $reserved = !$public && (($data['bookingStatus'] ?? '') === 'Reserved');
        $paymentMethod = $public ? '1Bill' : (string)($data['paymentMethod'] ?? 'Cash');
        if (!in_array($paymentMethod, ['Cash', 'Card', 'Bank transfer', '1Bill'], true)) {
            fail('Choose a valid payment method.', 422, 'validation_error');
        }
        $paymentReference = $public
            ? 'DEMO-' . strtoupper(substr(bin2hex(random_bytes(6)), 0, 10))
            : trim((string)($data['paymentReference'] ?? ''));
        if (!$reserved && $paymentMethod !== 'Cash' && $paymentReference === '') {
            fail('A verified payment reference is required.', 422, 'validation_error');
        }
        $fare = (float)$trip['route_fare'];
        $discount = $public ? 0.0 : min(decimal($data['discount'] ?? 0, 'discount'), $fare * count($seats));
        $total = round($fare * count($seats) - $discount, 2);
        $paid = $reserved ? 0.0 : $total;
        $balance = $reserved ? $total : 0.0;
        $id = uuid('booking-');
        $ticketNo = ($reserved ? 'RS-' : 'ME-') . date('ymd-His') . '-' . random_int(10, 99);
        $tripRunId = $trip['id'] . '-' . $travelDate . '-run-' . (int)$trip['run_number'];
        $createdBy = $user ? (int)$user['id'] : null;
        $issuedBy = $user['name'] ?? 'Public website';
        $expiresAt = $reserved ? date('Y-m-d H:i:s', time() + 7200) : null;
        $seatPrintedAt = $reserved ? null : date('Y-m-d H:i:s');
        $stmt = $pdo->prepare(
            'INSERT INTO bookings
             (id, ticket_no, source, passenger, phone, cnic, gender, route_label, destination, boarding_point,
              bus_registration, service, fare, discount, total, paid, balance, payment_method, payment_reference,
              payment_status, booking_status, travel_date, travel_time, driver, attendant, trip_id, trip_run_id,
              expires_at, seat_printed_at, issued_by, terminal, created_by)
             VALUES
             (:id, :ticket_no, :source, :passenger, :phone, :cnic, :gender, :route_label, :destination, :boarding_point,
              :bus_registration, :service, :fare, :discount, :total, :paid, :balance, :payment_method, :payment_reference,
              :payment_status, :booking_status, :travel_date, :travel_time, :driver, :attendant, :trip_id, :trip_run_id,
              :expires_at, :seat_printed_at, :issued_by, :terminal, :created_by)'
        );
        $stmt->execute([
            'id' => $id,
            'ticket_no' => $ticketNo,
            'source' => $source,
            'passenger' => trim((string)$data['passenger']),
            'phone' => trim((string)$data['phone']),
            'cnic' => trim((string)$data['cnic']),
            'gender' => in_array($data['gender'], ['Male', 'Female'], true) ? $data['gender'] : 'Male',
            'route_label' => $trip['origin'] . ' → ' . $trip['destination'],
            'destination' => $trip['destination'],
            'boarding_point' => trim((string)($data['boardingPoint'] ?? $trip['boarding_point'])),
            'bus_registration' => $trip['registration'],
            'service' => $trip['service'],
            'fare' => $fare,
            'discount' => $discount,
            'total' => $total,
            'paid' => $paid,
            'balance' => $balance,
            'payment_method' => $paymentMethod,
            'payment_reference' => $paymentReference ?: 'CASH-' . date('His'),
            'payment_status' => $reserved ? 'Unpaid' : 'Paid',
            'booking_status' => $reserved ? 'Reserved' : 'Confirmed',
            'travel_date' => $travelDate,
            'travel_time' => $trip['departure'],
            'driver' => $trip['driver'],
            'attendant' => $trip['attendant'],
            'trip_id' => $trip['id'],
            'trip_run_id' => $tripRunId,
            'expires_at' => $expiresAt,
            'seat_printed_at' => $seatPrintedAt,
            'issued_by' => $issuedBy,
            'terminal' => 'Madina Terminal, Peshawar',
            'created_by' => $createdBy,
        ]);
        $seatStmt = $pdo->prepare('INSERT INTO booking_seats (booking_id, trip_run_id, seat_number, active) VALUES (?, ?, ?, 1)');
        foreach ($seats as $seat) {
            $seatStmt->execute([$id, $tripRunId, $seat]);
        }
        if (!$reserved) {
            $stmt = $pdo->prepare("INSERT INTO financial_transactions (booking_id, transaction_type, amount, payment_method, reference, description, created_by) VALUES (?, 'sale', ?, ?, ?, ?, ?)");
            $stmt->execute([$id, $paid, $paymentMethod, $paymentReference ?: 'CASH-' . date('His'), 'Ticket ' . $ticketNo, $createdBy]);
        }
        $created = fetchBooking($id);
        audit('booking.created', 'booking', $id, null, $created, $createdBy);
        return $created;
    });
}

function updateBooking(string $id, array $data, array $user): array
{
    $before = fetchBooking($id);
    if (!$before) {
        fail('Booking not found.', 404, 'not_found');
    }
    if (in_array($before['bookingStatus'], ['Refunded', 'Cancelled'], true)) {
        fail('Closed bookings cannot be edited.', 409, 'booking_closed');
    }
    requireFields($data, ['passenger', 'phone', 'cnic', 'gender', 'destination', 'boardingPoint']);
    $stmt = db()->prepare('UPDATE bookings SET passenger = ?, phone = ?, cnic = ?, gender = ?, destination = ?, boarding_point = ? WHERE id = ?');
    $stmt->execute([
        trim((string)$data['passenger']),
        trim((string)$data['phone']),
        trim((string)$data['cnic']),
        in_array($data['gender'], ['Male', 'Female'], true) ? $data['gender'] : 'Male',
        trim((string)$data['destination']),
        trim((string)$data['boardingPoint']),
        $id,
    ]);
    $after = fetchBooking($id);
    audit('booking.updated', 'booking', $id, $before, $after, (int)$user['id']);
    return $after;
}

function cancelBooking(string $id, array $user): array
{
    return inTransaction(function (PDO $pdo) use ($id, $user): array {
        $before = fetchBooking($id);
        if (!$before) {
            fail('Booking not found.', 404, 'not_found');
        }
        if ($before['paid'] > 0) {
            fail('Paid bookings must be refunded instead of cancelled.', 409, 'refund_required');
        }
        $pdo->prepare("UPDATE bookings SET booking_status = 'Cancelled' WHERE id = ?")->execute([$id]);
        $pdo->prepare('UPDATE booking_seats SET active = 0 WHERE booking_id = ?')->execute([$id]);
        $after = fetchBooking($id);
        audit('booking.cancelled', 'booking', $id, $before, $after, (int)$user['id']);
        return $after;
    });
}

function confirmReservation(string $id, array $data, array $user): array
{
    if (fetchCurrentShift((int)$user['id']) === null) {
        fail('Open a counter shift before collecting reservation payment.', 409, 'shift_not_open');
    }
    return inTransaction(function (PDO $pdo) use ($id, $data, $user): array {
        $stmt = $pdo->prepare('SELECT * FROM bookings WHERE id = ? FOR UPDATE');
        $stmt->execute([$id]);
        $row = $stmt->fetch();
        if (!$row || $row['booking_status'] !== 'Reserved') {
            fail('Active reservation not found.', 404, 'not_found');
        }
        if ($row['expires_at'] && strtotime($row['expires_at']) <= time()) {
            fail('This reservation has expired.', 409, 'reservation_expired');
        }
        $method = (string)($data['paymentMethod'] ?? 'Cash');
        $reference = trim((string)($data['paymentReference'] ?? ''));
        if (!in_array($method, ['Cash', 'Card', 'Bank transfer', '1Bill'], true)) {
            fail('Choose a valid payment method.', 422, 'validation_error');
        }
        if ($method !== 'Cash' && $reference === '') {
            fail('A verified payment reference is required.', 422, 'validation_error');
        }
        $reference = $reference ?: 'CASH-' . date('His');
        $ticketNo = preg_replace('/^RS-/', 'ME-', $row['ticket_no']);
        $before = mapBooking($row);
        $pdo->prepare("UPDATE bookings SET ticket_no = ?, paid = total, balance = 0, payment_method = ?, payment_reference = ?, payment_status = 'Paid', booking_status = 'Confirmed', expires_at = NULL, seat_printed_at = NOW(), issued_by = ? WHERE id = ?")
            ->execute([$ticketNo, $method, $reference, $user['name'], $id]);
        $pdo->prepare("INSERT INTO financial_transactions (booking_id, transaction_type, amount, payment_method, reference, description, created_by) VALUES (?, 'sale', ?, ?, ?, ?, ?)")
            ->execute([$id, $row['total'], $method, $reference, 'Confirmed reservation ' . $ticketNo, $user['id']]);
        $after = fetchBooking($id);
        audit('reservation.confirmed', 'booking', $id, $before, $after, (int)$user['id']);
        return $after;
    });
}

function refundBooking(string $id, array $data, array $user): array
{
    requireFields($data, ['amount', 'method', 'reason']);
    return inTransaction(function (PDO $pdo) use ($id, $data, $user): array {
        $stmt = $pdo->prepare('SELECT * FROM bookings WHERE id = ? FOR UPDATE');
        $stmt->execute([$id]);
        $row = $stmt->fetch();
        if (!$row || (float)$row['paid'] <= 0) {
            fail('Paid booking not found.', 404, 'not_found');
        }
        $sumStmt = $pdo->prepare('SELECT COALESCE(SUM(amount), 0) FROM refunds WHERE booking_id = ?');
        $sumStmt->execute([$id]);
        $alreadyRefunded = (float)$sumStmt->fetchColumn();
        $remaining = round((float)$row['paid'] - $alreadyRefunded, 2);
        $amount = decimal($data['amount'], 'amount', 0.01);
        if ($amount > $remaining) {
            fail('Refund amount exceeds the remaining paid balance.', 422, 'refund_too_large');
        }
        $method = (string)$data['method'];
        $reason = (string)$data['reason'];
        if (!in_array($method, ['Cash', 'Card', 'Bank transfer', '1Bill'], true) || !in_array($reason, ['Passenger request', 'Trip cancelled', 'Duplicate payment', 'Service disruption', 'Other'], true)) {
            fail('Choose a valid refund method and reason.', 422, 'validation_error');
        }
        $reference = trim((string)($data['reference'] ?? ''));
        if ($method !== 'Cash' && $reference === '') {
            fail('A refund reference is required for non-cash refunds.', 422, 'validation_error');
        }
        $reference = $reference ?: 'CASH-' . date('His');
        $refundId = uuid('refund-');
        $before = mapBooking($row);
        $pdo->prepare('INSERT INTO refunds (id, booking_id, amount, method, reason, reference, notes, processed_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
            ->execute([$refundId, $id, $amount, $method, $reason, $reference, trim((string)($data['notes'] ?? '')), $user['id']]);
        $full = abs($amount - $remaining) < 0.001;
        $pdo->prepare('UPDATE bookings SET payment_status = ?, booking_status = ? WHERE id = ?')
            ->execute([$full ? 'Refunded' : 'Partially refunded', $full ? 'Refunded' : $row['booking_status'], $id]);
        if ($full) {
            $pdo->prepare('UPDATE booking_seats SET active = 0 WHERE booking_id = ?')->execute([$id]);
        }
        $pdo->prepare("INSERT INTO financial_transactions (booking_id, refund_id, transaction_type, amount, payment_method, reference, description, created_by) VALUES (?, ?, 'refund', ?, ?, ?, ?, ?)")
            ->execute([$id, $refundId, -$amount, $method, $reference, 'Refund: ' . $reason, $user['id']]);
        $after = fetchBooking($id);
        audit('booking.refunded', 'booking', $id, $before, $after, (int)$user['id']);
        return $after;
    });
}

function saveRoute(string $id, array $data, array $user): array
{
    requireFields($data, ['from', 'to', 'distance', 'duration', 'fare', 'boarding', 'status']);
    $id = $id === 'new' ? uuid('route-') : $id;
    $before = array_values(array_filter(fetchRoutes(), fn($item) => $item['id'] === $id))[0] ?? null;
    $stmt = db()->prepare(
        'INSERT INTO routes (id, origin, destination, distance, duration, fare, boarding_point, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE origin = VALUES(origin), destination = VALUES(destination), distance = VALUES(distance), duration = VALUES(duration), fare = VALUES(fare), boarding_point = VALUES(boarding_point), status = VALUES(status)'
    );
    $stmt->execute([$id, trim($data['from']), trim($data['to']), trim($data['distance']), trim($data['duration']), decimal($data['fare'], 'fare'), trim($data['boarding']), $data['status'] === 'Paused' ? 'Paused' : 'Active']);
    $after = array_values(array_filter(fetchRoutes(), fn($item) => $item['id'] === $id))[0];
    audit($before ? 'route.updated' : 'route.created', 'route', $id, $before, $after, (int)$user['id']);
    return $after;
}

function saveBus(string $id, array $data, array $user): array
{
    requireFields($data, ['registration', 'service', 'seats', 'model', 'year', 'status', 'nextService']);
    $id = $id === 'new' ? strtolower(preg_replace('/[^a-zA-Z0-9]+/', '-', trim($data['registration']))) : $id;
    $before = array_values(array_filter(fetchBuses(), fn($item) => $item['id'] === $id))[0] ?? null;
    $stmt = db()->prepare(
        'INSERT INTO buses (id, registration, service, seats, model, model_year, status, next_service) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE registration = VALUES(registration), service = VALUES(service), seats = VALUES(seats), model = VALUES(model), model_year = VALUES(model_year), status = VALUES(status), next_service = VALUES(next_service)'
    );
    $stmt->execute([$id, strtoupper(trim($data['registration'])), trim($data['service']), (int)$data['seats'], trim($data['model']), (int)$data['year'], $data['status'], trim($data['nextService'])]);
    $after = array_values(array_filter(fetchBuses(), fn($item) => $item['id'] === $id))[0];
    audit($before ? 'bus.updated' : 'bus.created', 'bus', $id, $before, $after, (int)$user['id']);
    return $after;
}

function saveTrip(string $id, array $data, array $user): array
{
    requireFields($data, ['routeId', 'busId', 'departure', 'arrival', 'driver', 'attendant', 'platform', 'status', 'days']);
    $id = $id === 'new' ? uuid('trip-') : $id;
    $days = array_values(array_intersect((array)$data['days'], ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']));
    if ($days === []) {
        fail('Select at least one service day.', 422, 'validation_error');
    }
    $before = array_values(array_filter(fetchTrips(), fn($item) => $item['id'] === $id))[0] ?? null;
    $stmt = db()->prepare(
        'INSERT INTO trips (id, route_id, bus_id, departure, arrival, driver, attendant, platform, status, service_days, active, run_number, last_departed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE route_id = VALUES(route_id), bus_id = VALUES(bus_id), departure = VALUES(departure), arrival = VALUES(arrival), driver = VALUES(driver), attendant = VALUES(attendant), platform = VALUES(platform), status = VALUES(status), service_days = VALUES(service_days), active = VALUES(active), run_number = VALUES(run_number), last_departed_at = VALUES(last_departed_at)'
    );
    $stmt->execute([$id, $data['routeId'], $data['busId'], $data['departure'], $data['arrival'], trim($data['driver']), trim($data['attendant']), trim($data['platform']), $data['status'], json_encode($days, JSON_THROW_ON_ERROR), !empty($data['active']) ? 1 : 0, (int)($data['runNumber'] ?? 1), !empty($data['lastDepartedAt']) ? date('Y-m-d H:i:s', strtotime($data['lastDepartedAt'])) : null]);
    $after = array_values(array_filter(fetchTrips(), fn($item) => $item['id'] === $id))[0];
    audit($before ? 'trip.updated' : 'trip.created', 'trip', $id, $before, $after, (int)$user['id']);
    return $after;
}

function saveCrew(string $key, array $data, array $user): array
{
    requireFields($data, ['name', 'role', 'phone', 'cnic', 'license', 'duty', 'status', 'initials']);
    $before = null;
    if ($key !== 'new') {
        $stmt = db()->prepare('SELECT * FROM crew WHERE name = ? LIMIT 1');
        $stmt->execute([$key]);
        $before = $stmt->fetch() ?: null;
    }
    if ($before) {
        $stmt = db()->prepare('UPDATE crew SET name = ?, role = ?, phone = ?, cnic = ?, license = ?, duty = ?, status = ?, initials = ? WHERE id = ?');
        $stmt->execute([trim($data['name']), $data['role'], trim($data['phone']), trim($data['cnic']), trim($data['license']), trim($data['duty']), $data['status'], strtoupper(trim($data['initials'])), $before['id']]);
        $id = (int)$before['id'];
    } else {
        $stmt = db()->prepare('INSERT INTO crew (name, role, phone, cnic, license, duty, status, initials) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
        $stmt->execute([trim($data['name']), $data['role'], trim($data['phone']), trim($data['cnic']), trim($data['license']), trim($data['duty']), $data['status'], strtoupper(trim($data['initials']))]);
        $id = (int)db()->lastInsertId();
    }
    $after = array_values(array_filter(fetchCrew(), fn($item) => $item['id'] === $id))[0];
    audit($before ? 'crew.updated' : 'crew.created', 'crew', (string)$id, $before, $after, (int)$user['id']);
    return $after;
}

function transitionTrip(string $id, array $data, array $user): array
{
    requireFields($data, ['action']);
    $action = $data['action'];
    if (!in_array($action, ['boarding', 'depart', 'next'], true)) {
        fail('Invalid trip transition.', 422, 'validation_error');
    }
    return inTransaction(function (PDO $pdo) use ($id, $action, $user): array {
        $before = array_values(array_filter(fetchTrips(), fn($item) => $item['id'] === $id))[0] ?? null;
        if (!$before) {
            fail('Trip not found.', 404, 'not_found');
        }
        if ($action === 'boarding') {
            $pdo->prepare("UPDATE trips SET status = 'Boarding' WHERE id = ?")->execute([$id]);
        } elseif ($action === 'depart') {
            $pdo->prepare("UPDATE trips SET status = 'Departed', last_departed_at = NOW() WHERE id = ?")->execute([$id]);
            $pdo->prepare("UPDATE buses SET status = 'On route' WHERE id = ?")->execute([$before['busId']]);
        } else {
            $pdo->prepare("UPDATE trips SET status = 'Scheduled', run_number = run_number + 1 WHERE id = ?")->execute([$id]);
        }
        $after = array_values(array_filter(fetchTrips(), fn($item) => $item['id'] === $id))[0];
        audit('trip.' . $action, 'trip', $id, $before, $after, (int)$user['id']);
        return $after;
    });
}

function openShift(array $data, array $user): array
{
    requireFields($data, ['counterName', 'openingCash']);
    $openingCash = decimal($data['openingCash'], 'openingCash');
    $counterName = trim((string)$data['counterName']);
    if (strlen($counterName) > 80) {
        fail('Counter name is too long.', 422, 'validation_error');
    }
    return inTransaction(function (PDO $pdo) use ($openingCash, $counterName, $user): array {
        $stmt = $pdo->prepare("SELECT id FROM counter_shifts WHERE opened_by = ? AND status = 'Open' FOR UPDATE");
        $stmt->execute([$user['id']]);
        if ($stmt->fetchColumn()) {
            fail('You already have an open shift.', 409, 'shift_already_open');
        }
        $baselineStmt = $pdo->prepare('SELECT COALESCE(MAX(id), 0) FROM financial_transactions WHERE created_by = ?');
        $baselineStmt->execute([$user['id']]);
        $openingTransactionId = (int)$baselineStmt->fetchColumn();
        $stmt = $pdo->prepare("INSERT INTO counter_shifts (business_date, counter_name, opening_cash, opening_transaction_id, status, opened_by) VALUES (CURDATE(), ?, ?, ?, 'Open', ?)");
        $stmt->execute([$counterName, $openingCash, $openingTransactionId, $user['id']]);
        $shift = fetchCurrentShift((int)$user['id']);
        audit('shift.opened', 'shift', (string)$shift['id'], null, $shift, (int)$user['id']);
        return $shift;
    });
}

function createExpense(array $data, array $user): array
{
    requireFields($data, ['date', 'category', 'description', 'amount', 'paymentMethod']);
    $amount = decimal($data['amount'], 'amount', 0.01);
    $category = allowed((string)$data['category'], ['Terminal', 'Fuel', 'Maintenance', 'Driver advance', 'Refreshment', 'Utilities', 'Salary', 'Other'], 'category');
    $method = allowed((string)$data['paymentMethod'], ['Cash', 'Card', 'Bank transfer'], 'paymentMethod');
    $date = DateTimeImmutable::createFromFormat('!Y-m-d', (string)$data['date']);
    if (!$date || $date->format('Y-m-d') !== $data['date']) {
        fail('Choose a valid expense date.', 422, 'validation_error');
    }
    $description = trim((string)$data['description']);
    if (strlen($description) > 255) {
        fail('Expense description is too long.', 422, 'validation_error');
    }
    $reference = trim((string)($data['reference'] ?? ''));
    if ($method !== 'Cash' && $reference === '') {
        fail('A payment reference is required for non-cash expenses.', 422, 'validation_error');
    }
    return inTransaction(function (PDO $pdo) use ($data, $user, $amount, $category, $method, $description, $reference): array {
        $shift = fetchCurrentShift((int)$user['id']);
        $stmt = $pdo->prepare('INSERT INTO expenses (expense_date, category, description, amount, payment_method, reference, notes, shift_id, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
        $stmt->execute([(string)$data['date'], $category, $description, $amount, $method, $reference, trim((string)($data['notes'] ?? '')), $shift['id'] ?? null, $user['id']]);
        $id = (int)$pdo->lastInsertId();
        $ledgerReference = $reference !== '' ? $reference : 'EXPENSE-' . $id;
        $pdo->prepare("INSERT INTO financial_transactions (transaction_type, amount, payment_method, reference, description, created_by) VALUES ('expense', ?, ?, ?, ?, ?)")
            ->execute([-$amount, $method, $ledgerReference, $category . ': ' . $description, $user['id']]);
        $expense = array_values(array_filter(fetchExpenses(), fn(array $item): bool => $item['id'] === $id))[0];
        audit('expense.created', 'expense', (string)$id, null, $expense, (int)$user['id']);
        return $expense;
    });
}

function closeShift(array $data, array $user): array
{
    requireFields($data, ['cashCounted', 'terminalExpense', 'driverAdvance', 'refreshment']);
    $cashCounted = decimal($data['cashCounted'], 'cashCounted');
    $terminalExpense = decimal($data['terminalExpense'], 'terminalExpense');
    $driverAdvance = decimal($data['driverAdvance'], 'driverAdvance');
    $refreshment = decimal($data['refreshment'], 'refreshment');
    return inTransaction(function (PDO $pdo) use ($data, $user, $cashCounted, $terminalExpense, $driverAdvance, $refreshment): array {
        $stmt = $pdo->prepare("SELECT * FROM counter_shifts WHERE opened_by = ? AND status = 'Open' ORDER BY opened_at DESC LIMIT 1 FOR UPDATE");
        $stmt->execute([$user['id']]);
        $shift = $stmt->fetch();
        if (!$shift) {
            fail('Open a shift before closing it.', 409, 'shift_not_open');
        }
        $salesStmt = $pdo->prepare("SELECT COALESCE(SUM(CASE WHEN payment_method = 'Cash' THEN amount ELSE 0 END), 0) cash_total, COALESCE(SUM(CASE WHEN payment_method <> 'Cash' THEN amount ELSE 0 END), 0) digital_total FROM financial_transactions WHERE created_by = ? AND id > ? AND transaction_type IN ('sale','refund','expense')");
        $salesStmt->execute([$user['id'], $shift['opening_transaction_id']]);
        $sales = $salesStmt->fetch();
        $closingExpenses = $terminalExpense + $driverAdvance + $refreshment;
        $expectedCash = (float)$shift['opening_cash'] + (float)$sales['cash_total'] - $closingExpenses;
        $digital = (float)$sales['digital_total'];
        $variance = $cashCounted - $expectedCash;
        $handover = max(0, $cashCounted - (float)$shift['opening_cash']);
        $stmt = $pdo->prepare('INSERT INTO shift_closures (shift_id, business_date, counter_name, opening_cash, cash_counted, expected_cash, digital_collections, terminal_expense, driver_advance, refreshment, remarks, handover, variance, closed_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
        $stmt->execute([$shift['id'], $shift['business_date'], $shift['counter_name'], $shift['opening_cash'], $cashCounted, $expectedCash, $digital, $terminalExpense, $driverAdvance, $refreshment, trim((string)($data['remarks'] ?? '')), $handover, $variance, $user['id']]);
        $closureId = (int)$pdo->lastInsertId();
        foreach ([['Terminal', 'Terminal expense', $terminalExpense], ['Driver advance', 'Driver advance', $driverAdvance], ['Refreshment', 'Refreshment', $refreshment]] as [$category, $label, $amount]) {
            if ($amount <= 0) continue;
            $reference = 'SHIFT-' . $shift['id'] . '-' . strtoupper(str_replace(' ', '-', $label));
            $pdo->prepare('INSERT INTO expenses (expense_date, category, description, amount, payment_method, reference, notes, shift_id, created_by) VALUES (CURDATE(), ?, ?, ?, \'Cash\', ?, ?, ?, ?)')
                ->execute([$category, $label, $amount, $reference, 'Recorded during shift close', $shift['id'], $user['id']]);
            $pdo->prepare("INSERT INTO financial_transactions (transaction_type, amount, payment_method, reference, description, created_by) VALUES ('expense', ?, 'Cash', ?, ?, ?)")
                ->execute([-$amount, $reference, $label, $user['id']]);
        }
        $pdo->prepare("UPDATE counter_shifts SET status = 'Closed', closed_by = ?, closed_at = NOW() WHERE id = ?")->execute([$user['id'], $shift['id']]);
        $pdo->prepare("INSERT INTO financial_transactions (transaction_type, amount, payment_method, reference, description, created_by) VALUES ('shift_close', 0, 'Cash', ?, 'Counter shift closed', ?)")
            ->execute(['SHIFT-' . $shift['id'], $user['id']]);
        $result = ['id' => $closureId, 'shiftId' => (int)$shift['id'], 'expectedCash' => $expectedCash, 'digital' => $digital, 'handover' => $handover, 'variance' => $variance, 'closedAt' => date(DATE_ATOM)];
        audit('shift.closed', 'shift', (string)$shift['id'], $shift, $result, (int)$user['id']);
        return $result;
    });
}

function createStaffUser(array $data, array $user): array
{
    requireFields($data, ['name', 'email', 'username', 'role', 'password']);
    $role = (string)$data['role'];
    if (!in_array($role, ['admin', 'manager', 'counter', 'dispatcher', 'finance'], true)) {
        fail('Choose a valid staff role.', 422, 'validation_error');
    }
    $email = strtolower(trim((string)$data['email']));
    if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
        fail('Enter a valid email address.', 422, 'validation_error');
    }
    $username = strtolower(trim((string)$data['username']));
    if (!preg_match('/^[a-z0-9._-]{3,40}$/', $username)) {
        fail('Username must be 3-40 characters using letters, numbers, dots, dashes or underscores.', 422, 'validation_error');
    }
    $password = (string)$data['password'];
    if (strlen($password) < 12 || !preg_match('/[A-Z]/', $password) || !preg_match('/[a-z]/', $password) || !preg_match('/\d/', $password) || !preg_match('/[^A-Za-z0-9]/', $password)) {
        fail('Use at least 12 characters with upper-case, lower-case, number and symbol.', 422, 'weak_password');
    }
    $stmt = db()->prepare('INSERT INTO users (name, email, username, password_hash, role, force_password_change) VALUES (?, ?, ?, ?, ?, 1)');
    $stmt->execute([
        trim((string)$data['name']),
        $email,
        $username,
        password_hash($password, PASSWORD_DEFAULT),
        $role,
    ]);
    $id = (int)db()->lastInsertId();
    $created = array_values(array_filter(fetchUsers(), fn(array $item): bool => $item['id'] === $id))[0];
    audit('user.created', 'user', (string)$id, null, $created, (int)$user['id']);
    return $created;
}
