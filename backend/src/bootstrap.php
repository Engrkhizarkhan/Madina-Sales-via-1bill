<?php
declare(strict_types=1);

const PROJECT_ROOT = __DIR__ . '/..';

function loadEnv(string $path): void
{
    if (!is_file($path)) {
        throw new RuntimeException('Backend configuration file is missing.');
    }
    foreach (file($path, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) ?: [] as $line) {
        $line = trim($line);
        if ($line === '' || str_starts_with($line, '#') || !str_contains($line, '=')) {
            continue;
        }
        [$key, $value] = array_map('trim', explode('=', $line, 2));
        $value = trim($value, "\"'");
        if (getenv($key) === false) {
            putenv("{$key}={$value}");
            $_ENV[$key] = $value;
        }
    }
}

loadEnv(PROJECT_ROOT . '/.env');

function envValue(string $key, ?string $default = null): string
{
    $value = getenv($key);
    if ($value === false || $value === '') {
        if ($default !== null) {
            return $default;
        }
        throw new RuntimeException("Required configuration {$key} is missing.");
    }
    return $value;
}

date_default_timezone_set('Asia/Karachi');

function db(): PDO
{
    static $pdo;
    if ($pdo instanceof PDO) {
        return $pdo;
    }
    $dsn = sprintf(
        'mysql:host=%s;port=%s;dbname=%s;charset=utf8mb4',
        envValue('DB_HOST', '127.0.0.1'),
        envValue('DB_PORT', '3306'),
        envValue('DB_NAME')
    );
    $pdo = new PDO($dsn, envValue('DB_USER'), envValue('DB_PASSWORD'), [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES => false,
    ]);
    $pdo->exec("SET time_zone = '+05:00'");
    return $pdo;
}

function jsonResponse(array $payload, int $status = 200): never
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
    exit;
}

function fail(string $message, int $status = 400, string $code = 'request_error'): never
{
    jsonResponse(['error' => ['code' => $code, 'message' => $message]], $status);
}

function requestData(): array
{
    $raw = file_get_contents('php://input') ?: '';
    if (strlen($raw) > 1048576) {
        fail('Request body is too large.', 413, 'request_too_large');
    }
    if ($raw === '') {
        return [];
    }
    try {
        $decoded = json_decode($raw, true, 512, JSON_THROW_ON_ERROR);
    } catch (JsonException) {
        fail('Request body must be valid JSON.', 400, 'invalid_json');
    }
    if (!is_array($decoded)) {
        fail('Request body must be a JSON object.', 400, 'invalid_json');
    }
    return $decoded;
}

function requireFields(array $data, array $fields): void
{
    foreach ($fields as $field) {
        if (!array_key_exists($field, $data) || (is_string($data[$field]) && trim($data[$field]) === '')) {
            fail("{$field} is required.", 422, 'validation_error');
        }
    }
}

function clientIp(): string
{
    return substr($_SERVER['REMOTE_ADDR'] ?? 'unknown', 0, 64);
}

function startSecureSession(): void
{
    if (session_status() === PHP_SESSION_ACTIVE) {
        return;
    }
    $secure = filter_var(envValue('SESSION_SECURE', 'false'), FILTER_VALIDATE_BOOL);
    session_name('madina_session');
    session_set_cookie_params([
        'lifetime' => 0,
        'path' => '/',
        'secure' => $secure,
        'httponly' => true,
        'samesite' => 'Lax',
    ]);
    session_start();
}

function currentUser(): ?array
{
    startSecureSession();
    if (!empty($_SESSION['last_activity']) && time() - (int)$_SESSION['last_activity'] > 28800) {
        $_SESSION = [];
        session_regenerate_id(true);
        return null;
    }
    if (empty($_SESSION['user_id'])) {
        return null;
    }
    $stmt = db()->prepare('SELECT id, name, email, username, role, active, force_password_change FROM users WHERE id = ? LIMIT 1');
    $stmt->execute([$_SESSION['user_id']]);
    $user = $stmt->fetch();
    if (!$user || !(bool)$user['active']) {
        $_SESSION = [];
        return null;
    }
    $_SESSION['last_activity'] = time();
    return $user;
}

function requireAuth(array $roles = []): array
{
    $user = currentUser();
    if (!$user) {
        fail('Authentication is required.', 401, 'unauthenticated');
    }
    if ($roles !== [] && !in_array($user['role'], $roles, true)) {
        fail('You do not have permission for this action.', 403, 'forbidden');
    }
    return $user;
}

function requireCsrf(): void
{
    startSecureSession();
    $provided = $_SERVER['HTTP_X_CSRF_TOKEN'] ?? '';
    if (empty($_SESSION['csrf']) || $provided === '' || !hash_equals($_SESSION['csrf'], $provided)) {
        fail('The security token is missing or expired. Please sign in again.', 403, 'csrf_failed');
    }
}

function publicUser(array $user): array
{
    return [
        'id' => (int)$user['id'],
        'name' => $user['name'],
        'email' => $user['email'],
        'username' => $user['username'],
        'role' => $user['role'],
        'forcePasswordChange' => (bool)$user['force_password_change'],
    ];
}

function audit(string $action, string $entityType, string $entityId, mixed $before, mixed $after, ?int $userId): void
{
    $stmt = db()->prepare(
        'INSERT INTO audit_logs (user_id, action, entity_type, entity_id, before_json, after_json, ip_address) VALUES (?, ?, ?, ?, ?, ?, ?)'
    );
    $stmt->execute([
        $userId,
        $action,
        $entityType,
        $entityId,
        $before === null ? null : json_encode($before, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR),
        $after === null ? null : json_encode($after, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR),
        clientIp(),
    ]);
}

function uuid(string $prefix = ''): string
{
    return $prefix . bin2hex(random_bytes(16));
}

function apiPath(): string
{
    $path = $_SERVER['PATH_INFO'] ?? '/';
    return '/' . trim($path, '/');
}

function routeMatches(string $pattern, string $path): ?array
{
    $regex = preg_replace_callback('/\{([a-zA-Z][a-zA-Z0-9_]*)\}/', fn($m) => '(?P<' . $m[1] . '>[^/]+)', $pattern);
    if (preg_match('#^' . $regex . '$#', $path, $matches) !== 1) {
        return null;
    }
    return array_filter($matches, 'is_string', ARRAY_FILTER_USE_KEY);
}

function decimal(mixed $value, string $field, float $minimum = 0): float
{
    if (!is_numeric($value)) {
        fail("{$field} must be a number.", 422, 'validation_error');
    }
    $number = round((float)$value, 2);
    if ($number < $minimum) {
        fail("{$field} must be at least {$minimum}.", 422, 'validation_error');
    }
    return $number;
}

function allowed(string $value, array $values, string $field): string
{
    if (!in_array($value, $values, true)) {
        fail("{$field} is invalid.", 422, 'validation_error');
    }
    return $value;
}

function isoDateTime(?string $value): ?string
{
    return $value ? (new DateTimeImmutable($value, new DateTimeZone('Asia/Karachi')))->format(DATE_ATOM) : null;
}

function handleCors(): void
{
    $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
    $allowedOrigins = array_filter(array_map('trim', explode(',', envValue('ALLOWED_ORIGINS', 'http://localhost'))));
    if ($origin !== '' && in_array($origin, $allowedOrigins, true)) {
        header("Access-Control-Allow-Origin: {$origin}");
        header('Access-Control-Allow-Credentials: true');
        header('Vary: Origin');
    }
    header('Access-Control-Allow-Headers: Content-Type, X-CSRF-Token');
    header('Access-Control-Allow-Methods: GET, POST, PUT, OPTIONS');
    header('X-Content-Type-Options: nosniff');
    header('X-Frame-Options: DENY');
    header('Referrer-Policy: same-origin');
    header("Permissions-Policy: camera=(), microphone=(), geolocation=()");
    header("Cache-Control: no-store");
    if (($_SERVER['REQUEST_METHOD'] ?? '') === 'OPTIONS') {
        http_response_code(204);
        exit;
    }
}
