<?php
// Smoke-test app: proves php-fpm, the DB secret, the DB connection, opcache
// and the writable uploads mount all work together. Safe to delete.
header('Content-Type: text/plain');
echo "Prometheus hello\n";
echo 'php: ' . PHP_VERSION . "\n";
echo 'opcache: ' . (function_exists('opcache_get_status') && ($s = @opcache_get_status(false)) && $s['opcache_enabled'] ? 'on' : 'off') . "\n";
echo 'https-seen: ' . (($_SERVER['HTTPS'] ?? '') ?: 'no') . "\n";

try {
    $pw = trim((string) @file_get_contents(getenv('DB_PASSWORD_FILE')));
    $pdo = new PDO(
        sprintf('mysql:host=%s;port=%s;dbname=%s;charset=utf8mb4', getenv('DB_HOST'), getenv('DB_PORT'), getenv('DB_NAME')),
        getenv('DB_USER'), $pw, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]
    );
    echo 'db: ok (' . $pdo->query('select version()')->fetchColumn() . ")\n";
} catch (Throwable $e) {
    echo 'db: FAIL ' . $e->getMessage() . "\n";
}

$probe = __DIR__ . '/files/.probe';
echo 'files: ' . (@file_put_contents($probe, (string) time()) !== false ? 'ok' : 'FAIL') . "\n";
