<?php
/**
 * seed_bot_8731737556.php
 * ───────────────────────
 * Seeds the database so bot 8731737556 has its own rows in every
 * bot_id-scoped table. Settings are cloned from 8958935808.
 * Safe to re-run — uses INSERT IGNORE / ON DUPLICATE KEY UPDATE.
 *
 * USAGE: Upload this file to your server and visit it once in a browser.
 * DELETE this file from the server after running it.
 */

require_once __DIR__ . '/config.php';

$NEW_BOT_ID = '8731737556';
$OLD_BOT_ID = '8958935808';

header('Content-Type: text/plain; charset=utf-8');

echo "=== Seeding bot_id: {$NEW_BOT_ID} ===\n\n";
echo "Primary bot_id (from BOT_TOKEN): {$adminBotId}\n";
echo "Cloning defaults from: {$OLD_BOT_ID}\n\n";

$errors = 0;

// ── 1. settings ──────────────────────────────────────────────────────────────
echo "--- settings table ---\n";
try {
    // Fetch all existing keys for new bot (to avoid overwriting)
    $stmt = $pdo->prepare('SELECT setting_key FROM settings WHERE bot_id = ?');
    $stmt->execute([$NEW_BOT_ID]);
    $existingKeys = array_column($stmt->fetchAll(), 'setting_key');

    // Fetch source rows from old bot
    $stmt = $pdo->prepare('SELECT setting_key, setting_value FROM settings WHERE bot_id = ?');
    $stmt->execute([$OLD_BOT_ID]);
    $sourceRows = $stmt->fetchAll();

    // Hard defaults (used only if source also has no row for that key)
    $defaults = [
        'rate_multiplier'  => '55',
        'discount_percent' => '0',
        'holiday_name'     => '',
        'maintenance_mode' => '0',
        'user_can_order'   => '1',
        'marquee_text'     => '',
        'top_services_ids' => '',
        'admin_password'   => $adminPassword,
    ];

    // Merge: defaults first, then source rows overwrite them
    $toInsert = $defaults;
    foreach ($sourceRows as $r) {
        $toInsert[$r['setting_key']] = $r['setting_value'];
    }

    $inserted = 0;
    foreach ($toInsert as $key => $value) {
        if (in_array($key, $existingKeys)) {
            echo "  SKIP  settings.{$key} already exists for {$NEW_BOT_ID}\n";
            continue;
        }
        $stmt = $pdo->prepare(
            'INSERT INTO settings (setting_key, bot_id, setting_value) VALUES (?, ?, ?)'
        );
        $stmt->execute([$key, $NEW_BOT_ID, $value]);
        echo "  OK    settings.{$key} = \"{$value}\"\n";
        $inserted++;
    }
    echo "  → {$inserted} rows inserted\n\n";
} catch (Exception $e) {
    echo "  ERROR: " . $e->getMessage() . "\n\n";
    $errors++;
}

// ── 2. admin_users ────────────────────────────────────────────────────────────
echo "--- admin_users table ---\n";
try {
    $pdo->exec("
        CREATE TABLE IF NOT EXISTS admin_users (
            id INT AUTO_INCREMENT PRIMARY KEY,
            username VARCHAR(255) NOT NULL,
            password VARCHAR(255) NOT NULL,
            bot_id VARCHAR(50) NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE KEY username_bot_id (username, bot_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    ");

    $adminUser = getEnvVar('ADMIN_USERNAME', 'admin');
    $stmt = $pdo->prepare("
        INSERT INTO admin_users (username, password, bot_id)
        VALUES (?, ?, ?)
        ON DUPLICATE KEY UPDATE password = VALUES(password)
    ");
    $stmt->execute([$adminUser, $adminPassword, $NEW_BOT_ID]);
    echo "  OK    admin_users: username={$adminUser}, bot_id={$NEW_BOT_ID}\n\n";
} catch (Exception $e) {
    echo "  ERROR: " . $e->getMessage() . "\n\n";
    $errors++;
}

// ── 3. Check bot_id columns and counts in all key tables ──────────────────────
echo "--- Checking key tables for bot_id column + row counts ---\n";
$tables = [
    'auth', 'orders', 'deposits', 'transactions',
    'alerts', 'chat_messages', 'service_custom',
    'broadcasts', 'broadcast_messages', 'withdrawals'
];

foreach ($tables as $table) {
    try {
        $stmt = $pdo->prepare("
            SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = 'bot_id'
        ");
        $stmt->execute([$table]);
        $hasBotId = $stmt->rowCount() > 0 || $stmt->fetch();

        if ($hasBotId) {
            $cnt = $pdo->prepare("SELECT COUNT(*) as c FROM `{$table}` WHERE bot_id = ?");
            $cnt->execute([$NEW_BOT_ID]);
            $count = $cnt->fetch()['c'];
            echo "  OK    {$table} — has bot_id column ({$count} rows for {$NEW_BOT_ID})\n";
        } else {
            echo "  WARN  {$table} — no bot_id column yet\n";
        }
    } catch (Exception $e) {
        echo "  WARN  {$table} — " . $e->getMessage() . "\n";
    }
}

echo "\n";
echo "============================================================\n";
if ($errors === 0) {
    echo "SUCCESS — Bot {$NEW_BOT_ID} is now ready in the database.\n";
} else {
    echo "DONE WITH {$errors} ERROR(S) — check output above.\n";
}
echo "\nNEXT STEP: Set BOT_TOKEN={$NEW_BOT_ID}:YOUR_FULL_TOKEN in server/.env\n";
echo "Then DELETE this file from your server for security.\n";
echo "============================================================\n";
