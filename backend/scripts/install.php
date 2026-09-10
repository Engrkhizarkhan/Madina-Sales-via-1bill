<?php
declare(strict_types=1);

require_once __DIR__ . '/../src/bootstrap.php';

$database = envValue('DB_NAME');
$appUser = envValue('DB_USER');
$appPassword = envValue('DB_PASSWORD');
foreach ([$database, $appUser] as $identifier) {
    if (!preg_match('/^[a-zA-Z0-9_]+$/', $identifier)) {
        throw new RuntimeException('Database and user names may contain only letters, numbers and underscores.');
    }
}

$adminUser = getenv('MYSQL_ADMIN_USER') ?: 'root';
$adminPassword = getenv('MYSQL_ADMIN_PASSWORD') ?: '';
$admin = new PDO(
    sprintf('mysql:host=%s;port=%s;charset=utf8mb4', envValue('DB_HOST', '127.0.0.1'), envValue('DB_PORT', '3306')),
    $adminUser,
    $adminPassword,
    [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_EMULATE_PREPARES => false]
);
$admin->exec("CREATE DATABASE IF NOT EXISTS `{$database}` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci");
$quotedPassword = $admin->quote($appPassword);
$admin->exec("CREATE USER IF NOT EXISTS '{$appUser}'@'localhost' IDENTIFIED BY {$quotedPassword}");
$admin->exec("CREATE USER IF NOT EXISTS '{$appUser}'@'127.0.0.1' IDENTIFIED BY {$quotedPassword}");
$admin->exec("ALTER USER '{$appUser}'@'localhost' IDENTIFIED BY {$quotedPassword}");
$admin->exec("ALTER USER '{$appUser}'@'127.0.0.1' IDENTIFIED BY {$quotedPassword}");
$admin->exec("GRANT SELECT, INSERT, UPDATE, DELETE ON `{$database}`.* TO '{$appUser}'@'localhost'");
$admin->exec("GRANT SELECT, INSERT, UPDATE, DELETE ON `{$database}`.* TO '{$appUser}'@'127.0.0.1'");
$admin->exec('FLUSH PRIVILEGES');

$schema = file_get_contents(__DIR__ . '/../database/schema.sql');
if ($schema === false) {
    throw new RuntimeException('Could not read database schema.');
}
$schemaDb = new PDO(
    sprintf('mysql:host=%s;port=%s;dbname=%s;charset=utf8mb4', envValue('DB_HOST', '127.0.0.1'), envValue('DB_PORT', '3306'), $database),
    $adminUser,
    $adminPassword,
    [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]
);
$schemaDb->exec($schema);

foreach (glob(__DIR__ . '/../database/migrations/*.sql') ?: [] as $migrationFile) {
    $migration = file_get_contents($migrationFile);
    if ($migration === false) {
        throw new RuntimeException('Could not read database migration: ' . basename($migrationFile));
    }
    $schemaDb->exec($migration);
}

$adminEmail = strtolower(envValue('ADMIN_EMAIL'));
$adminUsername = strtolower(envValue('ADMIN_USERNAME'));
$check = $schemaDb->prepare('SELECT id FROM users WHERE email = ? OR username = ? LIMIT 1');
$check->execute([$adminEmail, $adminUsername]);
if (!$check->fetchColumn()) {
    $stmt = $schemaDb->prepare("INSERT INTO users (name, email, username, password_hash, role, force_password_change) VALUES (?, ?, ?, ?, 'admin', 1)");
    $stmt->execute([
        envValue('ADMIN_NAME'),
        $adminEmail,
        $adminUsername,
        password_hash(envValue('ADMIN_PASSWORD'), PASSWORD_DEFAULT),
    ]);
}

$routes = [
    ['psh-khi', 'Peshawar', 'Karachi', '1,380 km', '14h 00m', 7000, 'Madina Terminal, Peshawar'],
    ['psh-lhr', 'Peshawar', 'Lahore', '520 km', '5h 45m', 4200, 'Madina Terminal, Peshawar'],
    ['psh-isb', 'Peshawar', 'Islamabad', '185 km', '2h 30m', 1800, 'Madina Terminal, Peshawar'],
    ['psh-mul', 'Peshawar', 'Multan', '690 km', '7h 30m', 4500, 'Madina Terminal, Peshawar'],
    ['khi-psh', 'Karachi', 'Peshawar', '1,380 km', '14h 15m', 7000, 'Sohrab Goth Terminal, Karachi'],
    ['lhr-psh', 'Lahore', 'Peshawar', '520 km', '5h 45m', 4200, 'Thokar Niaz Baig, Lahore'],
];
$stmt = $schemaDb->prepare("INSERT IGNORE INTO routes (id, origin, destination, distance, duration, fare, boarding_point, status) VALUES (?, ?, ?, ?, ?, ?, ?, 'Active')");
foreach ($routes as $route) {
    $stmt->execute($route);
}

$buses = [
    ['tae-388', 'TAE-388', 'Standard Plus', 49, 'Yutong ZK6122H9', 2024, 'On route', '12 Sep 2026'],
    ['taj-977', 'TAJ-977', 'Executive', 44, 'Daewoo BH-120', 2023, 'Ready', '18 Sep 2026'],
    ['les-221', 'LES-221', 'Sleeper Bus', 35, 'Yutong C13 Pro', 2025, 'Ready', '26 Sep 2026'],
    ['bsa-840', 'BSA-840', 'Executive', 41, 'Higer KLQ6128', 2022, 'Maintenance', 'In workshop'],
];
$stmt = $schemaDb->prepare('INSERT IGNORE INTO buses (id, registration, service, seats, model, model_year, status, next_service) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
foreach ($buses as $bus) {
    $stmt->execute($bus);
}

$crew = [
    ['Muhammad Ameen', 'Driver', '0300 1122456', '17301-2481162-1', 'HTV-PSH-10428', 'Peshawar → Karachi', 'On duty', 'MA'],
    ['Adeel Shah', 'Driver', '0304 3310098', '17301-8842160-7', 'HTV-PSH-11802', 'Available at terminal', 'Available', 'AS'],
    ['Ayesha Khan', 'Female attendant', '0315 6621908', '17301-6621908-4', '—', 'Peshawar → Karachi', 'On duty', 'AK'],
    ['Nazia Bibi', 'Female attendant', '0332 5514402', '17301-5514402-8', '—', 'Available at terminal', 'Available', 'NB'],
    ['Faisal Khan', 'Driver', '0307 9912045', '17301-9912045-2', 'HTV-PSH-12561', 'Peshawar → Lahore', 'Scheduled', 'FK'],
    ['Sadia Noor', 'Female attendant', '0318 7441280', '17301-7441280-5', '—', 'Peshawar → Lahore', 'Scheduled', 'SN'],
];
$stmt = $schemaDb->prepare('INSERT IGNORE INTO crew (name, role, phone, cnic, license, duty, status, initials) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
foreach ($crew as $person) {
    $stmt->execute($person);
}

$trips = [
    ['trip-0900', 'psh-isb', 'taj-977', '09:00', '11:30', 'Adeel Shah', 'Nazia Bibi', 'P-02', 'Scheduled', ['Mon','Tue','Wed','Thu','Fri','Sat','Sun']],
    ['trip-1600', 'psh-khi', 'tae-388', '16:00', '06:00', 'Muhammad Ameen', 'Ayesha Khan', 'P-01', 'Boarding', ['Mon','Tue','Wed','Thu','Fri','Sat','Sun']],
    ['trip-1900', 'psh-lhr', 'les-221', '19:00', '00:45', 'Faisal Khan', 'Sadia Noor', 'P-03', 'Scheduled', ['Mon','Tue','Wed','Thu','Fri','Sat','Sun']],
    ['trip-2130', 'psh-mul', 'taj-977', '21:30', '05:00', 'Adeel Shah', 'Nazia Bibi', 'P-04', 'Scheduled', ['Mon','Wed','Fri','Sun']],
];
$stmt = $schemaDb->prepare('INSERT IGNORE INTO trips (id, route_id, bus_id, departure, arrival, driver, attendant, platform, status, service_days, active, run_number) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1)');
foreach ($trips as $trip) {
    $days = array_pop($trip);
    $trip[] = json_encode($days, JSON_THROW_ON_ERROR);
    $stmt->execute($trip);
}

echo "Madina Express database installed successfully.\n";
