<?php
declare(strict_types=1);

require_once __DIR__ . '/../src/bootstrap.php';
require_once __DIR__ . '/../src/repository.php';
require_once __DIR__ . '/../src/operations.php';

try {
    configureHttp();
    dispatch();
} catch (PDOException $error) {
    error_log($error->__toString());
    if ((int)$error->errorInfo[1] === 1062) {
        fail('That record conflicts with an existing record.', 409, 'duplicate_record');
    }
    fail('The database operation failed.', 500, 'database_error');
} catch (Throwable $error) {
    error_log($error->__toString());
    $message = envValue('APP_ENV', 'production') === 'production'
        ? 'The server could not complete the request.'
        : $error->getMessage();
    fail($message, 500, 'server_error');
}

function configureHttp(): void
{
    $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
    $allowed = array_filter(array_map('trim', explode(',', envValue('ALLOWED_ORIGINS', ''))));
    if ($origin !== '' && in_array($origin, $allowed, true)) {
        header("Access-Control-Allow-Origin: {$origin}");
        header('Vary: Origin');
        header('Access-Control-Allow-Credentials: true');
        header('Access-Control-Allow-Headers: Content-Type, X-CSRF-Token');
        header('Access-Control-Allow-Methods: GET, POST, PUT, OPTIONS');
    }
    header('X-Content-Type-Options: nosniff');
    header('X-Frame-Options: DENY');
    header('Referrer-Policy: no-referrer');
    header("Permissions-Policy: camera=(), microphone=(), geolocation=()");
    header('Cache-Control: no-store, max-age=0');
    if (($_SERVER['REQUEST_METHOD'] ?? '') === 'OPTIONS') {
        http_response_code(204);
        exit;
    }
}

function dispatch(): never
{
    $method = strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');
    $path = apiPath();

    if ($method === 'GET' && $path === '/health') {
        db()->query('SELECT 1');
        jsonResponse([
            'status' => 'ok',
            'database' => 'connected',
            'time' => date(DATE_ATOM),
            'paymentMode' => envValue('PAYMENT_MODE', 'disabled'),
        ]);
    }
    if ($method === 'POST' && $path === '/auth/login') {
        login();
    }
    if ($method === 'POST' && $path === '/auth/logout') {
        requireAuth();
        requireCsrf();
        logout();
    }
    if ($method === 'GET' && $path === '/auth/me') {
        $user = requireAuth();
        startSecureSession();
        $_SESSION['csrf'] ??= bin2hex(random_bytes(32));
        jsonResponse(['user' => publicUser($user), 'csrfToken' => $_SESSION['csrf']]);
    }
    if ($method === 'POST' && $path === '/auth/change-password') {
        $user = requireAuth();
        requireCsrf();
        changePassword($user, requestData());
    }
    if ($method === 'GET' && $path === '/public/bootstrap') {
        if (!filter_var(envValue('PUBLIC_SITE_ENABLED', 'false'), FILTER_VALIDATE_BOOL)) {
            fail('Public booking is temporarily unavailable.', 404, 'public_site_disabled');
        }
        expireReservations();
        jsonResponse(publicBootstrap());
    }
    if ($method === 'POST' && $path === '/public/bookings') {
        if (!filter_var(envValue('PUBLIC_SITE_ENABLED', 'false'), FILTER_VALIDATE_BOOL)) {
            fail('Public booking is temporarily unavailable.', 404, 'public_site_disabled');
        }
        if (envValue('PAYMENT_MODE', 'disabled') !== 'demo') {
            fail('Online payments are not configured. Please book at the counter.', 503, 'payment_unavailable');
        }
        jsonResponse(['booking' => createBooking(requestData(), null, true)], 201);
    }

    $user = requireAuth();
    if ($method !== 'GET') {
        requireCsrf();
        if ((bool)$user['force_password_change']) {
            fail('Change the temporary password before making operational changes.', 403, 'password_change_required');
        }
    }
    if ($method === 'GET' && $path === '/admin/bootstrap') {
        expireReservations();
        jsonResponse([
            'bookings' => fetchBookings(),
            'fleet' => fetchBuses(),
            'trips' => fetchTrips(),
            'routes' => fetchRoutes(),
            'crew' => fetchCrew(),
            'users' => $user['role'] === 'admin' ? fetchUsers() : [],
            'shift' => fetchCurrentShift((int)$user['id']),
            'user' => publicUser($user),
            'paymentMode' => envValue('PAYMENT_MODE', 'disabled'),
        ]);
    }
    if ($method === 'POST' && $path === '/auth/finance-unlock') {
        requireRole($user, ['admin']);
        unlockFinance($user, requestData());
    }
    if ($method === 'GET' && $path === '/finance/status') {
        requireRole($user, ['admin']);
        jsonResponse(['unlocked' => financeIsUnlocked()]);
    }
    if ($method === 'POST' && $path === '/bookings') {
        requireRole($user, ['admin', 'manager', 'counter']);
        jsonResponse(['booking' => createBooking(requestData(), $user, false)], 201);
    }

    if (($params = routeMatches('/bookings/{id}', $path)) && $method === 'PUT') {
        requireRole($user, ['admin', 'manager', 'counter']);
        jsonResponse(['booking' => updateBooking($params['id'], requestData(), $user)]);
    }
    if (($params = routeMatches('/bookings/{id}/cancel', $path)) && $method === 'POST') {
        requireRole($user, ['admin', 'manager', 'counter']);
        jsonResponse(['booking' => cancelBooking($params['id'], $user)]);
    }
    if (($params = routeMatches('/bookings/{id}/confirm', $path)) && $method === 'POST') {
        requireRole($user, ['admin', 'manager', 'counter']);
        jsonResponse(['booking' => confirmReservation($params['id'], requestData(), $user)]);
    }
    if (($params = routeMatches('/bookings/{id}/refunds', $path)) && $method === 'POST') {
        requireRole($user, ['admin', 'manager', 'finance']);
        jsonResponse(['booking' => refundBooking($params['id'], requestData(), $user)], 201);
    }
    if (($params = routeMatches('/trips/{id}/transition', $path)) && $method === 'POST') {
        requireRole($user, ['admin', 'manager', 'dispatcher']);
        jsonResponse(['trip' => transitionTrip($params['id'], requestData(), $user)]);
    }
    if (($params = routeMatches('/routes/{id}', $path)) && in_array($method, ['POST', 'PUT'], true)) {
        requireRole($user, ['admin', 'manager']);
        jsonResponse(['route' => saveRoute($params['id'], requestData(), $user)]);
    }
    if (($params = routeMatches('/buses/{id}', $path)) && in_array($method, ['POST', 'PUT'], true)) {
        requireRole($user, ['admin', 'manager', 'dispatcher']);
        jsonResponse(['bus' => saveBus($params['id'], requestData(), $user)]);
    }
    if (($params = routeMatches('/trips/{id}', $path)) && in_array($method, ['POST', 'PUT'], true)) {
        requireRole($user, ['admin', 'manager', 'dispatcher']);
        jsonResponse(['trip' => saveTrip($params['id'], requestData(), $user)]);
    }
    if (($params = routeMatches('/crew/{key}', $path)) && in_array($method, ['POST', 'PUT'], true)) {
        requireRole($user, ['admin', 'manager']);
        jsonResponse(['person' => saveCrew(urldecode($params['key']), requestData(), $user)]);
    }
    if ($method === 'GET' && $path === '/shifts/current') {
        requireRole($user, ['admin', 'manager', 'counter']);
        jsonResponse(['shift' => fetchCurrentShift((int)$user['id'])]);
    }
    if ($method === 'POST' && $path === '/shifts/open') {
        requireRole($user, ['admin', 'manager', 'counter']);
        jsonResponse(['shift' => openShift(requestData(), $user)], 201);
    }
    if ($method === 'POST' && $path === '/shifts/close') {
        requireRole($user, ['admin', 'manager', 'counter']);
        jsonResponse(['shift' => closeShift(requestData(), $user)], 201);
    }
    if ($method === 'GET' && $path === '/expenses') {
        requireRole($user, ['admin']);
        requireFinanceUnlock();
        jsonResponse(['expenses' => fetchExpenses()]);
    }
    if ($method === 'POST' && $path === '/expenses') {
        requireRole($user, ['admin']);
        requireFinanceUnlock();
        jsonResponse(['expense' => createExpense(requestData(), $user)], 201);
    }
    if ($method === 'GET' && $path === '/audit') {
        requireRole($user, ['admin', 'manager']);
        $rows = db()->query('SELECT a.id, a.action, a.entity_type, a.entity_id, a.before_json, a.after_json, a.ip_address, a.created_at, u.name user_name FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id ORDER BY a.id DESC LIMIT 200')->fetchAll();
        jsonResponse(['events' => $rows]);
    }
    if ($method === 'POST' && $path === '/users') {
        requireRole($user, ['admin']);
        jsonResponse(['user' => createStaffUser(requestData(), $user)], 201);
    }

    fail('API route not found.', 404, 'not_found');
}

function requireRole(array $user, array $roles): void
{
    if (!in_array($user['role'], $roles, true)) {
        fail('You do not have permission for this action.', 403, 'forbidden');
    }
}

function financeIsUnlocked(): bool
{
    startSecureSession();
    return (int)($_SESSION['finance_unlocked_until'] ?? 0) > time();
}

function requireFinanceUnlock(): void
{
    if (!financeIsUnlocked()) {
        fail('Enter the administrator password to view finance.', 403, 'finance_locked');
    }
}

function unlockFinance(array $user, array $data): never
{
    requireFields($data, ['password']);
    $stmt = db()->prepare('SELECT password_hash FROM users WHERE id = ? AND role = \'admin\' AND active = 1 LIMIT 1');
    $stmt->execute([(int)$user['id']]);
    $hash = $stmt->fetchColumn();
    if (!$hash || !password_verify((string)$data['password'], (string)$hash)) {
        audit('finance.unlock_failed', 'user', (string)$user['id'], null, ['success' => false], (int)$user['id']);
        fail('The administrator password is incorrect.', 422, 'invalid_password');
    }
    startSecureSession();
    $_SESSION['finance_unlocked_until'] = time() + 900;
    audit('finance.unlocked', 'user', (string)$user['id'], null, ['duration_minutes' => 15], (int)$user['id']);
    jsonResponse(['unlocked' => true, 'expiresIn' => 900]);
}

function login(): never
{
    $data = requestData();
    requireFields($data, ['identity', 'password']);
    $stmt = db()->prepare('SELECT * FROM users WHERE email = ? OR username = ? LIMIT 1');
    $identity = strtolower(trim((string)$data['identity']));
    $stmt->execute([$identity, $identity]);
    $user = $stmt->fetch();
    if ($user && $user['locked_until'] && strtotime($user['locked_until']) > time()) {
        fail('Too many failed attempts. Try again later.', 429, 'account_locked');
    }
    if (!$user || !(bool)$user['active'] || !password_verify((string)$data['password'], $user['password_hash'])) {
        if ($user) {
            $attempts = (int)$user['failed_login_count'] + 1;
            $locked = $attempts >= 5 ? date('Y-m-d H:i:s', time() + 900) : null;
            $stmt = db()->prepare('UPDATE users SET failed_login_count = ?, locked_until = ? WHERE id = ?');
            $stmt->execute([$attempts, $locked, $user['id']]);
        }
        usleep(250000);
        fail('The username or password is incorrect.', 401, 'invalid_credentials');
    }
    db()->prepare('UPDATE users SET failed_login_count = 0, locked_until = NULL, last_login_at = NOW() WHERE id = ?')->execute([$user['id']]);
    startSecureSession();
    session_regenerate_id(true);
    $_SESSION['user_id'] = (int)$user['id'];
    $_SESSION['csrf'] = bin2hex(random_bytes(32));
    $_SESSION['last_activity'] = time();
    audit('auth.login', 'user', (string)$user['id'], null, ['success' => true], (int)$user['id']);
    jsonResponse(['user' => publicUser($user), 'csrfToken' => $_SESSION['csrf']]);
}

function logout(): never
{
    $userId = (int)($_SESSION['user_id'] ?? 0);
    audit('auth.logout', 'user', (string)$userId, null, ['success' => true], $userId ?: null);
    $_SESSION = [];
    if (ini_get('session.use_cookies')) {
        $params = session_get_cookie_params();
        setcookie(session_name(), '', time() - 42000, $params['path'], $params['domain'], $params['secure'], $params['httponly']);
    }
    session_destroy();
    jsonResponse(['ok' => true]);
}

function changePassword(array $user, array $data): never
{
    requireFields($data, ['currentPassword', 'newPassword']);
    $stmt = db()->prepare('SELECT password_hash FROM users WHERE id = ?');
    $stmt->execute([$user['id']]);
    $hash = (string)$stmt->fetchColumn();
    if (!password_verify((string)$data['currentPassword'], $hash)) {
        fail('The current password is incorrect.', 422, 'invalid_password');
    }
    $newPassword = (string)$data['newPassword'];
    if (strlen($newPassword) < 12 || !preg_match('/[A-Z]/', $newPassword) || !preg_match('/[a-z]/', $newPassword) || !preg_match('/\d/', $newPassword) || !preg_match('/[^A-Za-z0-9]/', $newPassword)) {
        fail('Use at least 12 characters with upper-case, lower-case, number and symbol.', 422, 'weak_password');
    }
    db()->prepare('UPDATE users SET password_hash = ?, force_password_change = 0 WHERE id = ?')->execute([
        password_hash($newPassword, PASSWORD_DEFAULT),
        $user['id'],
    ]);
    session_regenerate_id(true);
    $_SESSION['csrf'] = bin2hex(random_bytes(32));
    audit('auth.password_changed', 'user', (string)$user['id'], null, ['success' => true], (int)$user['id']);
    jsonResponse(['ok' => true, 'csrfToken' => $_SESSION['csrf']]);
}
