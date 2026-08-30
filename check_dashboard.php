<?php
require_once __DIR__ . '/config.php';

$botIdHeader = '8958935808'; // Test bot ID

try {
    echo "Running query 1: auth...\n";
    $stmt = $pdo->prepare('SELECT COUNT(*) as totalUsers FROM auth WHERE bot_id = :bot_id');
    $stmt->execute(['bot_id' => $botIdHeader]);
    $res = $stmt->fetch();
    var_dump($res);

    echo "\nRunning query 2: orders...\n";
    $stmt = $pdo->prepare('SELECT COUNT(*) as totalOrders FROM orders WHERE bot_id = :bot_id');
    $stmt->execute(['bot_id' => $botIdHeader]);
    $res = $stmt->fetch();
    var_dump($res);

    echo "\nRunning query 3: deposits...\n";
    $stmt = $pdo->prepare("SELECT COUNT(*) as totalDeposits FROM deposits WHERE status IN ('completed', 'success') AND bot_id = :bot_id");
    $stmt->execute(['bot_id' => $botIdHeader]);
    $res = $stmt->fetch();
    var_dump($res);

    echo "\nRunning query 4: totalRevenue...\n";
    $stmt = $pdo->prepare("SELECT COALESCE(SUM(amount), 0) as totalRevenue FROM deposits WHERE status IN ('completed', 'success') AND bot_id = :bot_id");
    $stmt->execute(['bot_id' => $botIdHeader]);
    $res = $stmt->fetch();
    var_dump($res);

    echo "\nRunning query 5: recentOrders...\n";
    $stmt = $pdo->prepare("
        SELECT o.*, a.username, a.first_name 
        FROM orders o 
        LEFT JOIN auth a ON o.user_id = a.tg_id AND a.bot_id = :bot_id_auth
        WHERE o.bot_id = :bot_id_order
        ORDER BY o.created_at DESC LIMIT 10
    ");
    $stmt->execute(['bot_id_auth' => $botIdHeader, 'bot_id_order' => $botIdHeader]);
    $res = $stmt->fetchAll();
    echo "Fetched " . count($res) . " orders.\n";

    echo "\nRunning query 6: recentDeposits...\n";
    $stmt = $pdo->prepare("
        SELECT d.*, a.username, a.first_name 
        FROM deposits d 
        LEFT JOIN auth a ON d.user_id = a.tg_id AND a.bot_id = :bot_id_auth
        WHERE d.bot_id = :bot_id_deposit
        ORDER BY d.created_at DESC LIMIT 10
    ");
    $stmt->execute(['bot_id_auth' => $botIdHeader, 'bot_id_deposit' => $botIdHeader]);
    $res = $stmt->fetchAll();
    echo "Fetched " . count($res) . " deposits.\n";

    echo "\nAll queries executed successfully!\n";

} catch (Exception $e) {
    echo "\nERROR EXECUTING QUERY: " . $e->getMessage() . "\n";
    echo $e->getTraceAsString() . "\n";
}
