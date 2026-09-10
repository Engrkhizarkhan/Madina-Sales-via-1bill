<?php
declare(strict_types=1);

require_once __DIR__ . '/../src/bootstrap.php';

$baseUrl = rtrim($argv[1] ?? 'http://localhost/madina-express-api/index.php', '/');
$cookieFile = tempnam(sys_get_temp_dir(), 'madina-api-test-');
$createdBookings = [];
$createdShiftId = null;
$createdCounterShiftId = null;
$createdExpenseId = null;
$createdExpenseReference = null;
$createdUserId = null;
$passed = 0;
$initialAuditId = (int)db()->query('SELECT COALESCE(MAX(id), 0) FROM audit_logs')->fetchColumn();
$adminStmt = db()->prepare('SELECT id, force_password_change FROM users WHERE username = ? LIMIT 1');
$adminStmt->execute([envValue('ADMIN_USERNAME')]);
$adminRow = $adminStmt->fetch();
$originalForcePasswordChange = $adminRow ? (int)$adminRow['force_password_change'] : 0;
if ($adminRow) {
    db()->prepare('UPDATE users SET force_password_change = 0 WHERE id = ?')->execute([$adminRow['id']]);
}

function check(bool $condition, string $message): void
{
    global $passed;
    if (!$condition) {
        throw new RuntimeException($message);
    }
    $passed++;
    echo "PASS  {$message}\n";
}

function apiRequest(string $method, string $path, ?array $body = null, ?string $csrf = null): array
{
    global $baseUrl, $cookieFile;
    $handle = curl_init($baseUrl . $path);
    $headers = ['Accept: application/json'];
    if ($body !== null) {
        $headers[] = 'Content-Type: application/json';
    }
    if ($csrf !== null) {
        $headers[] = 'X-CSRF-Token: ' . $csrf;
    }
    curl_setopt_array($handle, [
        CURLOPT_CUSTOMREQUEST => $method,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HEADER => false,
        CURLOPT_HTTPHEADER => $headers,
        CURLOPT_COOKIEJAR => $cookieFile,
        CURLOPT_COOKIEFILE => $cookieFile,
        CURLOPT_TIMEOUT => 15,
    ]);
    if ($body !== null) {
        curl_setopt($handle, CURLOPT_POSTFIELDS, json_encode($body, JSON_THROW_ON_ERROR));
    }
    $raw = curl_exec($handle);
    if ($raw === false) {
        throw new RuntimeException('HTTP request failed: ' . curl_error($handle));
    }
    $status = curl_getinfo($handle, CURLINFO_RESPONSE_CODE);
    curl_close($handle);
    $payload = json_decode($raw, true);
    if (!is_array($payload)) {
        throw new RuntimeException("Invalid JSON response ({$status}): {$raw}");
    }
    return ['status' => $status, 'body' => $payload];
}

function nextServiceDate(array $days): string
{
    $date = new DateTimeImmutable('tomorrow');
    for ($index = 0; $index < 14; $index++) {
        if (in_array($date->format('D'), $days, true)) {
            return $date->format('Y-m-d');
        }
        $date = $date->modify('+1 day');
    }
    throw new RuntimeException('No service date found.');
}

try {
    $health = apiRequest('GET', '/health');
    check($health['status'] === 200 && $health['body']['database'] === 'connected', 'health endpoint and MySQL connection');

    $unauthorized = apiRequest('GET', '/admin/bootstrap');
    check($unauthorized['status'] === 401, 'admin data rejects anonymous access');

    $public = apiRequest('GET', '/public/bootstrap');
    check($public['status'] === 404 && $public['body']['error']['code'] === 'public_site_disabled', 'public website is disabled until 1Bill is configured');

    $badLogin = apiRequest('POST', '/auth/login', ['identity' => 'not-a-user', 'password' => 'wrong']);
    check($badLogin['status'] === 401, 'invalid staff login is rejected');

    $login = apiRequest('POST', '/auth/login', [
        'identity' => envValue('ADMIN_USERNAME'),
        'password' => envValue('ADMIN_PASSWORD'),
    ]);
    check($login['status'] === 200 && !empty($login['body']['csrfToken']), 'staff login creates an authenticated session');
    $csrf = $login['body']['csrfToken'];

    $admin = apiRequest('GET', '/admin/bootstrap');
    check($admin['status'] === 200 && count($admin['body']['routes']) >= 1, 'authenticated operations data loads');

    $trip = $admin['body']['trips'][0];
    $travelDate = nextServiceDate($trip['days']);
    $bus = array_values(array_filter(
        $admin['body']['fleet'],
        fn(array $item): bool => $item['id'] === $trip['busId'],
    ))[0];
    $occupiedSeats = [];
    foreach ($admin['body']['bookings'] as $existingBooking) {
        if (($existingBooking['tripId'] ?? '') === $trip['id'] && $existingBooking['date'] === $travelDate && in_array($existingBooking['bookingStatus'], ['Confirmed', 'Reserved'], true)) {
            $occupiedSeats = array_merge($occupiedSeats, $existingBooking['seats']);
        }
    }
    $testSeat = null;
    for ($seat = (int)$bus['seats']; $seat >= 1; $seat--) {
        if (!in_array($seat, $occupiedSeats, true)) {
            $testSeat = $seat;
            break;
        }
    }
    if ($testSeat === null) {
        throw new RuntimeException('No free seat is available for the integration test.');
    }
    $bookingRequest = [
        'passenger' => 'Automated QA Passenger',
        'phone' => '03001234567',
        'cnic' => '17301-1234567-1',
        'gender' => 'Male',
        'tripId' => $trip['id'],
        'date' => $travelDate,
        'seats' => [$testSeat],
    ];
    $withoutShift = apiRequest('POST', '/bookings', $bookingRequest + [
        'bookingStatus' => 'Confirmed',
        'paymentMethod' => 'Cash',
        'discount' => 0,
    ], $csrf);
    check($withoutShift['status'] === 409 && $withoutShift['body']['error']['code'] === 'shift_not_open', 'counter sales require an open shift');

    $open = apiRequest('POST', '/shifts/open', [
        'counterName' => 'QA Counter',
        'openingCash' => 500,
    ], $csrf);
    check($open['status'] === 201 && $open['body']['shift']['status'] === 'Open', 'counter shift can be opened with starting cash');
    $createdCounterShiftId = (int)$open['body']['shift']['id'];
    $duplicateOpen = apiRequest('POST', '/shifts/open', ['counterName' => 'QA Counter', 'openingCash' => 0], $csrf);
    check($duplicateOpen['status'] === 409, 'a user cannot open two counter shifts');

    $counterBooking = apiRequest('POST', '/bookings', $bookingRequest + [
        'bookingStatus' => 'Confirmed',
        'paymentMethod' => 'Cash',
        'discount' => 0,
    ], $csrf);
    check($counterBooking['status'] === 201, 'counter POS creates a confirmed paid ticket');
    $booking = $counterBooking['body']['booking'];
    $createdBookings[] = $booking['id'];
    check($booking['paymentStatus'] === 'Paid' && $booking['paymentMethod'] === 'Cash', 'server records the paid counter state');

    $duplicate = apiRequest('POST', '/bookings', $bookingRequest + [
        'bookingStatus' => 'Confirmed',
        'paymentMethod' => 'Cash',
        'discount' => 0,
    ], $csrf);
    check($duplicate['status'] === 409, 'database prevents double-booking the same trip seat');

    $csrfFailure = apiRequest('POST', '/bookings/' . rawurlencode($booking['id']) . '/refunds', [
        'amount' => 1,
        'method' => 'Cash',
        'reason' => 'Other',
        'reference' => 'QA-NO-CSRF',
        'notes' => 'Expected rejection',
    ]);
    check(
        $csrfFailure['status'] === 403,
        'state changes require a valid CSRF token (received ' . $csrfFailure['status'] . ': ' . json_encode($csrfFailure['body']) . ')',
    );

    $partialAmount = round(((float)$booking['paid']) / 2, 2);
    $refund = apiRequest('POST', '/bookings/' . rawurlencode($booking['id']) . '/refunds', [
        'amount' => $partialAmount,
        'method' => 'Cash',
        'reason' => 'Passenger request',
        'reference' => 'QA-PARTIAL-' . time(),
        'notes' => 'Automated integration test',
    ], $csrf);
    check($refund['status'] === 201 && $refund['body']['booking']['paymentStatus'] === 'Partially refunded', 'partial refund is persisted');

    $tooMuch = apiRequest('POST', '/bookings/' . rawurlencode($booking['id']) . '/refunds', [
        'amount' => (float)$booking['paid'] + 1,
        'method' => 'Cash',
        'reason' => 'Other',
        'reference' => 'QA-EXCESS-' . time(),
        'notes' => '',
    ], $csrf);
    check($tooMuch['status'] === 422, 'refund cannot exceed the remaining paid balance');

    $fullRefund = apiRequest('POST', '/bookings/' . rawurlencode($booking['id']) . '/refunds', [
        'amount' => $partialAmount,
        'method' => 'Cash',
        'reason' => 'Passenger request',
        'reference' => 'QA-FINAL-' . time(),
        'notes' => 'Complete automated refund',
    ], $csrf);
    check($fullRefund['status'] === 201 && $fullRefund['body']['booking']['bookingStatus'] === 'Refunded', 'full cumulative refund closes the booking');

    $replacement = apiRequest('POST', '/bookings', $bookingRequest + [
        'bookingStatus' => 'Reserved',
        'paymentMethod' => 'Cash',
        'discount' => 0,
    ], $csrf);
    check($replacement['status'] === 201 && $replacement['body']['booking']['bookingStatus'] === 'Reserved', 'full refund releases the seat for a new reservation');
    $reserved = $replacement['body']['booking'];
    $createdBookings[] = $reserved['id'];

    $confirmed = apiRequest('POST', '/bookings/' . rawurlencode($reserved['id']) . '/confirm', [
        'paymentMethod' => 'Cash',
    ], $csrf);
    check($confirmed['status'] === 200 && $confirmed['body']['booking']['bookingStatus'] === 'Confirmed', 'counter reservation can be paid and confirmed');

    $lockedExpenses = apiRequest('GET', '/expenses');
    check($lockedExpenses['status'] === 403 && $lockedExpenses['body']['error']['code'] === 'finance_locked', 'finance data is blurred until the administrator unlocks it');

    $wrongUnlock = apiRequest('POST', '/auth/finance-unlock', ['password' => 'definitely-wrong'], $csrf);
    check($wrongUnlock['status'] === 422, 'incorrect finance password is rejected');
    $unlock = apiRequest('POST', '/auth/finance-unlock', ['password' => envValue('ADMIN_PASSWORD')], $csrf);
    check($unlock['status'] === 200 && $unlock['body']['unlocked'] === true, 'administrator password unlocks finance temporarily');

    $createdExpenseReference = 'QA-EXP-' . time();
    $expense = apiRequest('POST', '/expenses', [
        'date' => date('Y-m-d'),
        'category' => 'Terminal',
        'description' => 'Automated QA expense',
        'amount' => 100,
        'paymentMethod' => 'Cash',
        'reference' => $createdExpenseReference,
        'notes' => 'Integration cleanup expected',
    ], $csrf);
    check($expense['status'] === 201 && (float)$expense['body']['expense']['amount'] === 100.0, 'administrator can record an audited expense');
    $createdExpenseId = (int)$expense['body']['expense']['id'];
    $expenseList = apiRequest('GET', '/expenses');
    check($expenseList['status'] === 200 && count($expenseList['body']['expenses']) >= 1, 'unlocked expense history loads');

    $currentShift = apiRequest('GET', '/shifts/current');
    check($currentShift['status'] === 200 && (float)$currentShift['body']['shift']['expectedCash'] > 400.0, 'open shift tracks ticket payments, refunds and cash expenses');
    $expectedCash = (float)$currentShift['body']['shift']['expectedCash'];

    $close = apiRequest('POST', '/shifts/close', [
        'cashCounted' => $expectedCash,
        'terminalExpense' => 0,
        'driverAdvance' => 0,
        'refreshment' => 0,
        'remarks' => 'Automated QA close',
    ], $csrf);
    check($close['status'] === 201 && isset($close['body']['shift']['variance']), 'shift reconciliation is persisted');
    $createdShiftId = (int)$close['body']['shift']['id'];

    $audit = apiRequest('GET', '/audit');
    check($audit['status'] === 200 && count($audit['body']['events']) >= 5, 'audit trail records sensitive operations');

    $qaUsername = 'qa-counter-' . time();
    $qaPassword = 'QaCounter!2026';
    $createdUser = apiRequest('POST', '/users', [
        'name' => 'Automated QA Counter',
        'email' => $qaUsername . '@example.invalid',
        'username' => $qaUsername,
        'role' => 'counter',
        'password' => $qaPassword,
    ], $csrf);
    check($createdUser['status'] === 201 && $createdUser['body']['user']['role'] === 'counter', 'administrator can create a role-scoped staff account');
    $createdUserId = (int)$createdUser['body']['user']['id'];
    db()->prepare('UPDATE users SET force_password_change = 0 WHERE id = ?')->execute([$createdUserId]);

    $logout = apiRequest('POST', '/auth/logout', [], $csrf);
    check($logout['status'] === 200, 'logout invalidates the staff session');
    $afterLogout = apiRequest('GET', '/admin/bootstrap');
    check($afterLogout['status'] === 401, 'logged-out session cannot access operations');

    $counterLogin = apiRequest('POST', '/auth/login', ['identity' => $qaUsername, 'password' => $qaPassword]);
    check($counterLogin['status'] === 200, 'new staff account can authenticate');
    $counterCsrf = $counterLogin['body']['csrfToken'];
    $counterBootstrap = apiRequest('GET', '/admin/bootstrap');
    check($counterBootstrap['status'] === 200 && $counterBootstrap['body']['users'] === [], 'non-admin roles cannot retrieve staff-account records');
    $staffFinance = apiRequest('GET', '/finance/status');
    check($staffFinance['status'] === 403 && $staffFinance['body']['error']['code'] === 'forbidden', 'staff cannot view the protected finance area');
    $staffUnlock = apiRequest('POST', '/auth/finance-unlock', ['password' => $qaPassword], $counterCsrf);
    check($staffUnlock['status'] === 403, 'staff cannot unlock finance with their own password');
    $forbiddenRefund = apiRequest('POST', '/bookings/' . rawurlencode($booking['id']) . '/refunds', [
        'amount' => 1,
        'method' => 'Cash',
        'reason' => 'Other',
        'reference' => 'QA-FORBIDDEN',
        'notes' => '',
    ], $counterCsrf);
    check($forbiddenRefund['status'] === 403 && $forbiddenRefund['body']['error']['code'] === 'forbidden', 'counter role cannot issue refunds');
    apiRequest('POST', '/auth/logout', [], $counterCsrf);

    echo "\n{$passed} integration checks passed.\n";
} finally {
    if ($createdExpenseId !== null) {
        db()->prepare("DELETE FROM audit_logs WHERE entity_type = 'expense' AND entity_id = ?")->execute([(string)$createdExpenseId]);
        if ($createdExpenseReference !== null) {
            db()->prepare("DELETE FROM financial_transactions WHERE transaction_type = 'expense' AND reference = ?")->execute([$createdExpenseReference]);
        }
        db()->prepare('DELETE FROM expenses WHERE id = ?')->execute([$createdExpenseId]);
    }
    if ($createdShiftId !== null) {
        db()->prepare('DELETE FROM shift_closures WHERE id = ?')->execute([$createdShiftId]);
    }
    if ($createdCounterShiftId !== null) {
        db()->prepare("DELETE FROM audit_logs WHERE entity_type = 'shift' AND entity_id = ?")->execute([(string)$createdCounterShiftId]);
        db()->prepare("DELETE FROM financial_transactions WHERE reference = ? OR reference LIKE ?")->execute([
            'SHIFT-' . $createdCounterShiftId,
            'SHIFT-' . $createdCounterShiftId . '-%',
        ]);
        db()->prepare('DELETE FROM counter_shifts WHERE id = ?')->execute([$createdCounterShiftId]);
    }
    if ($createdBookings !== []) {
        $pdo = db();
        $placeholders = implode(',', array_fill(0, count($createdBookings), '?'));
        $pdo->beginTransaction();
        try {
            $pdo->prepare("DELETE FROM audit_logs WHERE entity_type = 'booking' AND entity_id IN ({$placeholders})")->execute($createdBookings);
            $pdo->prepare("DELETE FROM financial_transactions WHERE booking_id IN ({$placeholders})")->execute($createdBookings);
            $pdo->prepare("DELETE FROM refunds WHERE booking_id IN ({$placeholders})")->execute($createdBookings);
            $pdo->prepare("DELETE FROM booking_seats WHERE booking_id IN ({$placeholders})")->execute($createdBookings);
            $pdo->prepare("DELETE FROM bookings WHERE id IN ({$placeholders})")->execute($createdBookings);
            $pdo->commit();
        } catch (Throwable $cleanupError) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
            fwrite(STDERR, "Cleanup warning: {$cleanupError->getMessage()}\n");
        }
    }
    if (is_string($cookieFile) && file_exists($cookieFile)) {
        unlink($cookieFile);
    }
    db()->prepare('DELETE FROM audit_logs WHERE id > ?')->execute([$initialAuditId]);
    if ($createdUserId !== null) {
        db()->prepare('DELETE FROM audit_logs WHERE user_id = ? OR (entity_type = ? AND entity_id = ?)')->execute([
            $createdUserId,
            'user',
            (string)$createdUserId,
        ]);
        db()->prepare('DELETE FROM users WHERE id = ?')->execute([$createdUserId]);
    }
    if ($adminRow) {
        db()->prepare('UPDATE users SET force_password_change = ? WHERE id = ?')->execute([
            $originalForcePasswordChange,
            $adminRow['id'],
        ]);
    }
}
