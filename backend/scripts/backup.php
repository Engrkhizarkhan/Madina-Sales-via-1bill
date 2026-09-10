<?php
declare(strict_types=1);

require_once __DIR__ . '/../src/bootstrap.php';

$targetDir = __DIR__ . '/../backups';
if (!is_dir($targetDir) && !mkdir($targetDir, 0700, true) && !is_dir($targetDir)) {
    throw new RuntimeException('Could not create backup directory.');
}
$target = $targetDir . '/madina-express-' . date('Ymd-His') . '.sql';
$mysqldump = getenv('MYSQLDUMP_PATH') ?: 'C:\\xamppp\\mysql\\bin\\mysqldump.exe';
$defaultsFile = tempnam(sys_get_temp_dir(), 'madina-mysql-');
if ($defaultsFile === false) {
    throw new RuntimeException('Could not create temporary database credentials file.');
}
file_put_contents(
    $defaultsFile,
    "[client]\n" .
    'host=' . envValue('DB_HOST', '127.0.0.1') . "\n" .
    'port=' . envValue('DB_PORT', '3306') . "\n" .
    'user=' . envValue('DB_USER') . "\n" .
    'password=' . envValue('DB_PASSWORD') . "\n",
    LOCK_EX,
);
@chmod($defaultsFile, 0600);
try {
    $command = sprintf(
        '"%s" --defaults-extra-file="%s" --single-transaction --default-character-set=utf8mb4 %s > "%s"',
        $mysqldump,
        $defaultsFile,
        escapeshellarg(envValue('DB_NAME')),
        $target,
    );
    exec($command, $output, $exitCode);
} finally {
    @unlink($defaultsFile);
}
if ($exitCode !== 0 || !is_file($target) || filesize($target) === 0) {
    @unlink($target);
    throw new RuntimeException('Database backup failed.');
}
echo $target . PHP_EOL;
