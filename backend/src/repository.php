<?php
declare(strict_types=1);

function fetchRoutes(bool $activeOnly = false): array
{
    $sql = 'SELECT id, origin, destination, distance, duration, fare, boarding_point, status FROM routes';
    if ($activeOnly) {
        $sql .= " WHERE status = 'Active'";
    }
    $sql .= ' ORDER BY origin, destination';
    return array_map(fn(array $row): array => [
        'id' => $row['id'],
        'from' => $row['origin'],
        'to' => $row['destination'],
        'distance' => $row['distance'],
        'duration' => $row['duration'],
        'fare' => (float)$row['fare'],
        'boarding' => $row['boarding_point'],
        'status' => $row['status'],
    ], db()->query($sql)->fetchAll());
}

function fetchBuses(bool $publicOnly = false): array
{
    $sql = 'SELECT id, registration, service, seats, model, model_year, status, next_service FROM buses';
    if ($publicOnly) {
        $sql .= " WHERE status <> 'Retired'";
    }
    $sql .= ' ORDER BY registration';
    return array_map(fn(array $row): array => [
        'id' => $row['id'],
        'registration' => $row['registration'],
        'service' => $row['service'],
        'seats' => (int)$row['seats'],
        'model' => $row['model'],
        'year' => (int)$row['model_year'],
        'status' => $row['status'],
        'nextService' => $row['next_service'],
    ], db()->query($sql)->fetchAll());
}

function fetchCrew(): array
{
    $rows = db()->query('SELECT id, name, role, phone, cnic, license, duty, status, initials FROM crew ORDER BY name')->fetchAll();
    return array_map(fn(array $row): array => [
        'id' => (int)$row['id'],
        'name' => $row['name'],
        'role' => $row['role'],
        'phone' => $row['phone'],
        'cnic' => $row['cnic'],
        'license' => $row['license'],
        'duty' => $row['duty'],
        'status' => $row['status'],
        'initials' => $row['initials'],
    ], $rows);
}

function fetchUsers(): array
{
    $rows = db()->query('SELECT id, name, email, username, role, active, force_password_change, last_login_at, created_at FROM users ORDER BY name')->fetchAll();
    return array_map(fn(array $row): array => [
        'id' => (int)$row['id'],
        'name' => $row['name'],
        'email' => $row['email'],
        'username' => $row['username'],
        'role' => $row['role'],
        'active' => (bool)$row['active'],
        'forcePasswordChange' => (bool)$row['force_password_change'],
        'lastLoginAt' => isoDateTime($row['last_login_at']),
        'createdAt' => isoDateTime($row['created_at']),
    ], $rows);
}

function fetchCurrentShift(int $userId): ?array
{
    $stmt = db()->prepare(
        "SELECT s.id, s.business_date, s.counter_name, s.opening_cash, s.status, s.opened_at,
                COALESCE(SUM(CASE WHEN ft.payment_method = 'Cash' THEN ft.amount ELSE 0 END), 0) cash_activity,
                COALESCE(SUM(CASE WHEN ft.payment_method <> 'Cash' THEN ft.amount ELSE 0 END), 0) digital_activity
         FROM counter_shifts s
         LEFT JOIN financial_transactions ft ON ft.created_by = s.opened_by AND ft.id > s.opening_transaction_id
         WHERE s.opened_by = ? AND s.status = 'Open'
         GROUP BY s.id
         ORDER BY s.opened_at DESC LIMIT 1"
    );
    $stmt->execute([$userId]);
    $row = $stmt->fetch();
    if (!$row) {
        return null;
    }
    return [
        'id' => (int)$row['id'],
        'businessDate' => $row['business_date'],
        'counterName' => $row['counter_name'],
        'openingCash' => (float)$row['opening_cash'],
        'expectedCash' => (float)$row['opening_cash'] + (float)$row['cash_activity'],
        'digitalCollections' => (float)$row['digital_activity'],
        'status' => $row['status'],
        'openedAt' => isoDateTime($row['opened_at']),
    ];
}

function fetchExpenses(): array
{
    $rows = db()->query(
        'SELECT e.id, e.expense_date, e.category, e.description, e.amount, e.payment_method, e.reference, e.notes, e.shift_id, e.created_at, u.name created_by_name
         FROM expenses e JOIN users u ON u.id = e.created_by ORDER BY e.expense_date DESC, e.id DESC LIMIT 1000'
    )->fetchAll();
    return array_map(fn(array $row): array => [
        'id' => (int)$row['id'],
        'date' => $row['expense_date'],
        'category' => $row['category'],
        'description' => $row['description'],
        'amount' => (float)$row['amount'],
        'paymentMethod' => $row['payment_method'],
        'reference' => $row['reference'],
        'notes' => $row['notes'],
        'shiftId' => $row['shift_id'] === null ? null : (int)$row['shift_id'],
        'createdBy' => $row['created_by_name'],
        'createdAt' => isoDateTime($row['created_at']),
    ], $rows);
}

function fetchTrips(bool $activeOnly = false): array
{
    $sql = 'SELECT id, route_id, bus_id, TIME_FORMAT(departure, "%H:%i") departure, TIME_FORMAT(arrival, "%H:%i") arrival, driver, attendant, platform, status, service_days, active, run_number, last_departed_at FROM trips';
    if ($activeOnly) {
        $sql .= ' WHERE active = 1';
    }
    $sql .= ' ORDER BY departure';
    return array_map(fn(array $row): array => [
        'id' => $row['id'],
        'routeId' => $row['route_id'],
        'busId' => $row['bus_id'],
        'departure' => $row['departure'],
        'arrival' => $row['arrival'],
        'driver' => $row['driver'],
        'attendant' => $row['attendant'],
        'platform' => $row['platform'],
        'status' => $row['status'],
        'days' => json_decode($row['service_days'], true, 512, JSON_THROW_ON_ERROR),
        'active' => (bool)$row['active'],
        'runNumber' => (int)$row['run_number'],
        'lastDepartedAt' => isoDateTime($row['last_departed_at']),
    ], db()->query($sql)->fetchAll());
}

function fetchBooking(string $id): ?array
{
    $stmt = db()->prepare('SELECT * FROM bookings WHERE id = ? LIMIT 1');
    $stmt->execute([$id]);
    $row = $stmt->fetch();
    return $row ? mapBooking($row) : null;
}

function fetchBookings(): array
{
    return array_map('mapBooking', db()->query('SELECT * FROM bookings ORDER BY created_at DESC')->fetchAll());
}

function mapBooking(array $row): array
{
    $seatStmt = db()->prepare('SELECT seat_number FROM booking_seats WHERE booking_id = ? ORDER BY seat_number');
    $seatStmt->execute([$row['id']]);
    $seats = array_map('intval', array_column($seatStmt->fetchAll(), 'seat_number'));

    $refundStmt = db()->prepare(
        'SELECT r.id, r.amount, r.method, r.reason, r.reference, r.notes, r.processed_at, u.name processed_by_name
         FROM refunds r JOIN users u ON u.id = r.processed_by
         WHERE r.booking_id = ? ORDER BY r.processed_at'
    );
    $refundStmt->execute([$row['id']]);
    $refunds = array_map(fn(array $refund): array => [
        'id' => $refund['id'],
        'amount' => (float)$refund['amount'],
        'method' => $refund['method'],
        'reason' => $refund['reason'],
        'reference' => $refund['reference'],
        'notes' => $refund['notes'],
        'processedAt' => isoDateTime($refund['processed_at']),
        'processedBy' => $refund['processed_by_name'],
    ], $refundStmt->fetchAll());

    return [
        'id' => $row['id'],
        'ticketNo' => $row['ticket_no'],
        'source' => $row['source'],
        'passenger' => $row['passenger'],
        'phone' => $row['phone'],
        'cnic' => $row['cnic'],
        'gender' => $row['gender'],
        'route' => $row['route_label'],
        'destination' => $row['destination'],
        'boardingPoint' => $row['boarding_point'],
        'bus' => $row['bus_registration'],
        'service' => $row['service'],
        'seats' => $seats,
        'fare' => (float)$row['fare'],
        'discount' => (float)$row['discount'],
        'total' => (float)$row['total'],
        'paid' => (float)$row['paid'],
        'balance' => (float)$row['balance'],
        'paymentMethod' => $row['payment_method'],
        'paymentReference' => $row['payment_reference'],
        'paymentStatus' => $row['payment_status'],
        'bookingStatus' => $row['booking_status'],
        'date' => $row['travel_date'],
        'time' => substr($row['travel_time'], 0, 5),
        'driver' => $row['driver'],
        'attendant' => $row['attendant'],
        'createdAt' => isoDateTime($row['created_at']),
        'expiresAt' => isoDateTime($row['expires_at']),
        'tripId' => $row['trip_id'],
        'tripRunId' => $row['trip_run_id'],
        'seatPrintedAt' => isoDateTime($row['seat_printed_at']),
        'issuedBy' => $row['issued_by'],
        'terminal' => $row['terminal'],
        'refunds' => $refunds,
    ];
}

function expireReservations(): int
{
    $pdo = db();
    $pdo->beginTransaction();
    try {
        $ids = $pdo->query("SELECT id FROM bookings WHERE booking_status = 'Reserved' AND expires_at IS NOT NULL AND expires_at <= NOW() FOR UPDATE")->fetchAll(PDO::FETCH_COLUMN);
        if ($ids === []) {
            $pdo->commit();
            return 0;
        }
        $placeholders = implode(',', array_fill(0, count($ids), '?'));
        $stmt = $pdo->prepare("UPDATE bookings SET booking_status = 'Cancelled' WHERE id IN ({$placeholders})");
        $stmt->execute($ids);
        $stmt = $pdo->prepare("UPDATE booking_seats SET active = 0 WHERE booking_id IN ({$placeholders})");
        $stmt->execute($ids);
        foreach ($ids as $id) {
            audit('reservation.expired', 'booking', (string)$id, null, ['bookingStatus' => 'Cancelled'], null);
        }
        $pdo->commit();
        return count($ids);
    } catch (Throwable $error) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        throw $error;
    }
}

function publicOccupancy(): array
{
    $sql = "SELECT bs.trip_run_id, b.bus_registration, b.travel_date, TIME_FORMAT(b.travel_time, '%H:%i') travel_time, bs.seat_number
            FROM booking_seats bs JOIN bookings b ON b.id = bs.booking_id
            WHERE bs.active = 1 AND b.booking_status IN ('Confirmed','Reserved')";
    $groups = [];
    foreach (db()->query($sql)->fetchAll() as $row) {
        $key = $row['trip_run_id'];
        if (!isset($groups[$key])) {
            $groups[$key] = [
                'tripRunId' => $row['trip_run_id'],
                'bus' => $row['bus_registration'],
                'date' => $row['travel_date'],
                'time' => $row['travel_time'],
                'seats' => [],
            ];
        }
        $groups[$key]['seats'][] = (int)$row['seat_number'];
    }
    return array_values($groups);
}

function adminBootstrap(): array
{
    expireReservations();
    return [
        'bookings' => fetchBookings(),
        'fleet' => fetchBuses(),
        'trips' => fetchTrips(),
        'routes' => fetchRoutes(),
        'crew' => fetchCrew(),
        'users' => fetchUsers(),
    ];
}

function publicBootstrap(): array
{
    expireReservations();
    return [
        'fleet' => fetchBuses(true),
        'trips' => fetchTrips(true),
        'routes' => fetchRoutes(true),
        'occupancy' => publicOccupancy(),
        'paymentMode' => envValue('PAYMENT_MODE', 'disabled'),
    ];
}
