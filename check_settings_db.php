<?php
require_once __DIR__ . '/config.php';

try {
    $stmt = $pdo->query("SELECT * FROM settings");
    $rows = $stmt->fetchAll();
    echo "SETTINGS TABLE ROWS:\n";
    foreach ($rows as $row) {
        echo "Key: {$row['setting_key']} | Bot ID: {$row['bot_id']} | Value: {$row['setting_value']}\n";
    }
} catch (Exception $e) {
    echo "Error: " . $e->getMessage() . "\n";
}
