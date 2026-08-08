<?php
/**
 * Admin Routes — Paxyo Admin Panel Backend
 */

require_once __DIR__ . '/../config.php';
require_once __DIR__ . '/../auth.php';// Auto-create withdrawals table if it does not exist
try {
    $pdo->exec("
        CREATE TABLE IF NOT EXISTS withdrawals (
            id INT AUTO_INCREMENT PRIMARY KEY,
            user_id VARCHAR(255) NOT NULL,
            amount DECIMAL(10, 2) NOT NULL,
            full_name VARCHAR(255) NOT NULL,
            bank_name VARCHAR(255) NOT NULL,
            account_number VARCHAR(255) NOT NULL,
            status VARCHAR(50) DEFAULT 'pending',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    ");

    $pdo->exec("
        CREATE TABLE IF NOT EXISTS admin_users (
            id INT AUTO_INCREMENT PRIMARY KEY,
            username VARCHAR(255) NOT NULL,
            password VARCHAR(255) NOT NULL,
            bot_id VARCHAR(50) NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE KEY username_bot_id (username, bot_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    ");

    $pdo->exec("
        CREATE TABLE IF NOT EXISTS broadcasts (
            id INT AUTO_INCREMENT PRIMARY KEY,
            message TEXT NOT NULL,
            image_url VARCHAR(512) DEFAULT NULL,
            btn_text VARCHAR(255) DEFAULT 'Open App 🎵',
            btn_url VARCHAR(512) DEFAULT 'https://musical-caramel-cae47e.netlifyapp/',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    ");

    $pdo->exec("
        CREATE TABLE IF NOT EXISTS broadcast_messages (
            id INT AUTO_INCREMENT PRIMARY KEY,
            broadcast_id INT NOT NULL,
            tg_id VARCHAR(255) NOT NULL,
            telegram_message_id INT NOT NULL,
            status VARCHAR(50) DEFAULT 'sent',
            error_message TEXT DEFAULT NULL,
            custom_message TEXT DEFAULT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (broadcast_id) REFERENCES broadcasts(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    ");

    try { $pdo->exec("ALTER TABLE broadcasts ADD COLUMN btn_text VARCHAR(255) DEFAULT 'Open App 🎵'"); } catch (Exception $e) {}
    try { $pdo->exec("ALTER TABLE broadcasts ADD COLUMN btn_url VARCHAR(512) DEFAULT 'https://musical-caramel-cae47e.netlifyapp/'"); } catch (Exception $e) {}
    try { $pdo->exec("ALTER TABLE broadcast_messages ADD COLUMN custom_message TEXT DEFAULT NULL"); } catch (Exception $e) {}
    try { $pdo->exec("ALTER TABLE broadcasts ADD COLUMN bot_id VARCHAR(50) DEFAULT NULL"); } catch (Exception $e) {}
    try { $pdo->exec("ALTER TABLE broadcast_messages ADD COLUMN bot_id VARCHAR(50) DEFAULT NULL"); } catch (Exception $e) {}
} catch (PDOException $e) {
    // Fail silently
}

global $adminPassword, $adminBotId;

$method = $_SERVER['REQUEST_METHOD'];

// ─── Read Authorization header ────────────────────────────────────
$authHeader = '';
if (isset($_SERVER['HTTP_AUTHORIZATION'])) {
    $authHeader = $_SERVER['HTTP_AUTHORIZATION'];
} elseif (isset($_SERVER['REDIRECT_HTTP_AUTHORIZATION'])) {
    $authHeader = $_SERVER['REDIRECT_HTTP_AUTHORIZATION'];
} elseif (function_exists('apache_request_headers')) {
    $reqHeaders = apache_request_headers();
    if (isset($reqHeaders['Authorization'])) $authHeader = $reqHeaders['Authorization'];
    elseif (isset($reqHeaders['authorization'])) $authHeader = $reqHeaders['authorization'];
}

$providedPass = '';
if (preg_match('/Bearer\s+(.*)$/i', $authHeader, $matches)) {
    $providedPass = trim($matches[1]);
}

// ─── Helper: get effective admin password (DB override > env) ─────
function getEffectiveAdminPassword() {
    global $pdo, $adminPassword, $adminBotId;
    try {
        $stmt = $pdo->prepare("SELECT setting_value FROM settings WHERE setting_key = 'admin_password' AND bot_id = :bot_id LIMIT 1");
        $stmt->execute(['bot_id' => $adminBotId]);
        $row = $stmt->fetch();
        if ($row && !empty($row['setting_value'])) {
            return $row['setting_value'];
        }
    } catch (Exception $e) { /* fall through */ }
    return $adminPassword; // env fallback
}

// ─── ROUTE: /admin/login (POST) ─────────────────────────────────
if ($route === '/admin/login' && $method === 'POST') {
    $password = isset($requestData['password']) ? trim($requestData['password']) : '';

    if (empty($password)) {
        http_response_code(400);
        echo json_encode(['success' => false, 'error' => 'Password is required']);
        exit;
    }

    $effective = getEffectiveAdminPassword();

    if ($password === $effective) {
        echo json_encode(['success' => true, 'token' => $password]);
    } else {
        http_response_code(401);
        echo json_encode(['success' => false, 'error' => 'Invalid password']);
    }
    exit;
}

// ─── Auth guard for all other /admin/* routes ────────────────────
if (
    $route !== '/admin/login' && 
    $route !== '/admin/reseller/deposit/callback' && 
    $route !== '/admin/reseller/deposit/public-status'
) {
    $effective = getEffectiveAdminPassword();
    if (empty($providedPass) || $providedPass !== $effective) {
        http_response_code(401);
        echo json_encode(['error' => 'Unauthorized: Invalid or missing password']);
        exit;
    }
}

// The bot_id for scoping data comes from the server env (transparent to admin UI)
$botIdHeader = $adminBotId;



// Helper to sanitize database output types
function formatOrderRow($row) {
    if (isset($row['id'])) $row['id'] = (int)$row['id'];
    if (isset($row['service_id'])) $row['service_id'] = (int)$row['service_id'];
    if (isset($row['quantity'])) $row['quantity'] = (int)$row['quantity'];
    
    $val = 0.0;
    if (isset($row['cost']) && $row['cost'] !== null) {
        $val = (float)$row['cost'];
    } elseif (isset($row['charge']) && $row['charge'] !== null) {
        $val = (float)$row['charge'];
    }
    $row['cost'] = $val;
    $row['charge'] = $val;
    
    if (isset($row['start_count'])) $row['start_count'] = (int)$row['start_count'];
    if (isset($row['remains'])) $row['remains'] = (int)$row['remains'];
    return $row;
}

function formatDepositRow($row) {
    if (isset($row['id'])) $row['id'] = (int)$row['id'];
    if (isset($row['amount'])) $row['amount'] = (float)$row['amount'];
    return $row;
}

function formatUserRow($row) {
    if (isset($row['id'])) $row['id'] = (int)$row['id'];
    if (isset($row['balance'])) $row['balance'] = (float)$row['balance'];
    if (isset($row['total_spent'])) $row['total_spent'] = $row['total_spent'] !== null ? (float)$row['total_spent'] : null;
    return $row;
}

// ─── ROUTE: /admin/debug-log (GET) ──────────────────────────────
if ($route === '/admin/debug-log' && $method === 'GET') {
    header('Content-Type: text/plain');
    $logFile = __DIR__ . '/dashboard_error.log';
    if (file_exists($logFile)) {
        echo file_get_contents($logFile);
    } else {
        echo "No debug log file found at: " . $logFile;
    }
    exit;
}

// ─── ROUTE: /admin/change-password (POST) ───────────────────────
if ($route === '/admin/change-password' && $method === 'POST') {
    $newPassword = isset($requestData['newPassword']) ? trim($requestData['newPassword']) : '';

    if (empty($newPassword) || strlen($newPassword) < 6) {
        http_response_code(400);
        echo json_encode(['success' => false, 'error' => 'New password must be at least 6 characters']);
        exit;
    }

    try {
        // Store new password in settings table scoped to this bot
        $stmt = $pdo->prepare("
            INSERT INTO settings (setting_key, bot_id, setting_value)
            VALUES ('admin_password', :bot_id, :value)
            ON DUPLICATE KEY UPDATE setting_value = :value_update
        ");
        $stmt->execute(['bot_id' => $adminBotId, 'value' => $newPassword, 'value_update' => $newPassword]);
        echo json_encode(['success' => true]);
    } catch (Exception $e) {
        http_response_code(500);
        echo json_encode(['success' => false, 'error' => 'Failed to save new password', 'details' => $e->getMessage()]);
    }
    exit;
}

// ─── ROUTE: /admin/dashboard (GET) ──────────────────────────────
if ($route === '/admin/dashboard' && $method === 'GET') {
    $step = 'start';
    try {
        $step = 'querying totalUsers count';
        $stmt = $pdo->prepare('SELECT COUNT(*) as totalUsers FROM auth WHERE bot_id = :bot_id');
        $stmt->execute(['bot_id' => $botIdHeader]);
        $totalUsers = (int)$stmt->fetch()['totalUsers'];

        $step = 'querying totalOrders count';
        $stmt = $pdo->prepare('SELECT COUNT(*) as totalOrders FROM orders WHERE bot_id = :bot_id');
        $stmt->execute(['bot_id' => $botIdHeader]);
        $totalOrders = (int)$stmt->fetch()['totalOrders'];

        $step = 'querying totalDeposits count';
        $stmt = $pdo->prepare("SELECT COUNT(*) as totalDeposits FROM deposits WHERE status IN ('completed', 'success') AND bot_id = :bot_id");
        $stmt->execute(['bot_id' => $botIdHeader]);
        $totalDeposits = (int)$stmt->fetch()['totalDeposits'];

        $step = 'querying totalRevenue count';
        $stmt = $pdo->prepare("SELECT COALESCE(SUM(amount), 0) as totalRevenue FROM deposits WHERE status IN ('completed', 'success') AND bot_id = :bot_id");
        $stmt->execute(['bot_id' => $botIdHeader]);
        $totalRevenue = (float)$stmt->fetch()['totalRevenue'];

        $step = 'querying recentOrders';
        $stmt = $pdo->prepare("
            SELECT o.*, a.username, a.first_name 
            FROM orders o 
            LEFT JOIN auth a ON o.user_id = a.tg_id AND a.bot_id = :bot_id_auth
            WHERE o.bot_id = :bot_id_order
            ORDER BY o.created_at DESC LIMIT 10
        ");
        $stmt->execute(['bot_id_auth' => $botIdHeader, 'bot_id_order' => $botIdHeader]);
        $recentOrders = array_map('formatOrderRow', $stmt->fetchAll());

        $step = 'querying recentDeposits';
        $stmt = $pdo->prepare("
            SELECT d.*, a.username, a.first_name 
            FROM deposits d 
            LEFT JOIN auth a ON d.user_id = a.tg_id AND a.bot_id = :bot_id_auth
            WHERE d.bot_id = :bot_id_deposit
            ORDER BY d.created_at DESC LIMIT 10
        ");
        $stmt->execute(['bot_id_auth' => $botIdHeader, 'bot_id_deposit' => $botIdHeader]);
        $recentDeposits = array_map('formatDepositRow', $stmt->fetchAll());

        echo json_encode([
            'totalUsers'     => $totalUsers,
            'totalOrders'    => $totalOrders,
            'totalDeposits'  => $totalDeposits,
            'totalRevenue'   => $totalRevenue,
            'recentOrders'   => $recentOrders,
            'recentDeposits' => $recentDeposits
        ]);
    } catch (Exception $e) {
        http_response_code(500);
        $debugData = [
            'error' => 'Failed to load dashboard',
            'details' => $e->getMessage(),
            'failed_at_step' => $step,
            'bot_id_header' => $botIdHeader,
            'trace' => $e->getTraceAsString()
        ];
        file_put_contents(__DIR__ . '/dashboard_error.log', print_r($debugData, true));
        echo json_encode($debugData);
    }
    exit;
}

// ─── ROUTE: /admin/users (GET) ──────────────────────────────────
if ($route === '/admin/users' && $method === 'GET') {
    try {
        $page = isset($requestData['page']) ? (int)$requestData['page'] : 1;
        $limit = isset($requestData['limit']) ? (int)$requestData['limit'] : 20;
        $search = isset($requestData['search']) ? $requestData['search'] : '';
        $sortBy = isset($requestData['sortBy']) ? $requestData['sortBy'] : 'last_login';
        $sortOrder = isset($requestData['sortOrder']) ? $requestData['sortOrder'] : 'desc';
        $offset = ($page - 1) * $limit;

        $whereClause = '';
        $params = [];
        $conditions = ['bot_id = :bot_id'];
        $params['bot_id'] = $botIdHeader;

        if (!empty($search)) {
            $conditions[] = '(tg_id LIKE :s1 OR username LIKE :s2 OR first_name LIKE :s3 OR last_name LIKE :s4)';
            $params['s1'] = "%{$search}%";
            $params['s2'] = "%{$search}%";
            $params['s3'] = "%{$search}%";
            $params['s4'] = "%{$search}%";
        }

        $username = isset($requestData['username']) ? $requestData['username'] : '';
        if (!empty($username)) {
            $conditions[] = 'username LIKE :username';
            $params['username'] = "%{$username}%";
        }

        if (!empty($conditions)) {
            $whereClause = 'WHERE ' . implode(' AND ', $conditions);
        }

        $validSortColumns = [
            'recent_registration' => 'created_at',
            'big_balance'         => 'balance',
            'total_spent'         => 'total_spent',
            'recent_active'       => 'last_login',
            'last_deposit'        => 'last_deposit',
            'last_order'          => 'last_order',
        ];
        $sortColumn = isset($validSortColumns[$sortBy]) ? $validSortColumns[$sortBy] : 'last_login';
        $orderDir = strtoupper($sortOrder) === 'ASC' ? 'ASC' : 'DESC';

        // Count Total
        $countQuery = "SELECT COUNT(*) as total FROM auth {$whereClause}";
        $stmt = $pdo->prepare($countQuery);
        $stmt->execute($params);
        $total = (int)$stmt->fetch()['total'];

        // Get rows
        $dataQuery = "SELECT * FROM auth {$whereClause} ORDER BY {$sortColumn} {$orderDir} LIMIT :limit OFFSET :offset";
        $stmt = $pdo->prepare($dataQuery);
        foreach ($params as $key => $val) {
            $stmt->bindValue(":{$key}", $val, PDO::PARAM_STR);
        }
        $stmt->bindValue(':limit', $limit, PDO::PARAM_INT);
        $stmt->bindValue(':offset', $offset, PDO::PARAM_INT);
        $stmt->execute();
        
        $users = array_map('formatUserRow', $stmt->fetchAll());

        echo json_encode(['users' => $users, 'total' => $total]);
    } catch (Exception $e) {
        http_response_code(500);
        echo json_encode(['error' => 'Failed to load users', 'details' => $e->getMessage()]);
    }
    exit;
}

// ─── ROUTE: /admin/users/balance (POST) ─────────────────────────
if ($route === '/admin/users/balance' && $method === 'POST') {
    try {
        $tgId = isset($requestData['tg_id']) ? $requestData['tg_id'] : null;
        $amount = isset($requestData['amount']) ? (float)$requestData['amount'] : null;

        if (empty($tgId) || $amount === null) {
            http_response_code(400);
            echo json_encode(['error' => 'tg_id and amount are required']);
            exit;
        }

        $pdo->beginTransaction();

        $stmt = $pdo->prepare('UPDATE auth SET balance = balance + :amount WHERE tg_id = :tg_id AND bot_id = :bot_id');
        $stmt->execute(['amount' => $amount, 'tg_id' => $tgId, 'bot_id' => $botIdHeader]);

        $stmt = $pdo->prepare('SELECT balance FROM auth WHERE tg_id = :tg_id AND bot_id = :bot_id');
        $stmt->execute(['tg_id' => $tgId, 'bot_id' => $botIdHeader]);
        $user = $stmt->fetch();

        if (!$user) {
            $pdo->rollBack();
            http_response_code(404);
            echo json_encode(['error' => 'User not found']);
            exit;
        }

        $newBalance = (float)$user['balance'];

        // Log transaction
        $txType = ($amount >= 0) ? 'bonus' : 'refund';
        $stmt = $pdo->prepare("
            INSERT INTO transactions (user_id, type, amount, balance_after, reference_type, description, bot_id, created_at)
            VALUES (:tg_id, :type, :amount, :balance_after, 'admin', 'Admin balance adjustment', :bot_id, NOW())
        ");
        $stmt->execute(['tg_id' => $tgId, 'type' => $txType, 'amount' => $amount, 'balance_after' => $newBalance, 'bot_id' => $botIdHeader]);

        $pdo->commit();

        echo json_encode(['success' => true, 'newBalance' => $newBalance]);
    } catch (Exception $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        http_response_code(500);
        echo json_encode(['error' => 'Failed to update balance', 'details' => $e->getMessage()]);
    }
    exit;
}

// ─── ROUTE: /admin/users/role (POST) ────────────────────────────
if ($route === '/admin/users/role' && $method === 'POST') {
    try {
        $tgId = isset($requestData['tg_id']) ? $requestData['tg_id'] : null;
        $role = isset($requestData['role']) ? $requestData['role'] : null;

        if (empty($tgId) || empty($role)) {
            http_response_code(400);
            echo json_encode(['error' => 'tg_id and role are required']);
            exit;
        }

        $stmt = $pdo->prepare('UPDATE auth SET role = :role WHERE tg_id = :tg_id AND bot_id = :bot_id');
        $stmt->execute(['role' => $role, 'tg_id' => $tgId, 'bot_id' => $botIdHeader]);

        echo json_encode(['success' => true]);
    } catch (Exception $e) {
        http_response_code(500);
        echo json_encode(['error' => 'Failed to update role', 'details' => $e->getMessage()]);
    }
    exit;
}

// ─── ROUTE: /admin/alerts (POST) ─────────────────────────────────
if ($route === '/admin/alerts' && $method === 'POST') {
    try {
        $target = isset($requestData['target']) ? $requestData['target'] : null;
        $title = isset($requestData['title']) ? $requestData['title'] : null;
        $message = isset($requestData['message']) ? $requestData['message'] : null;
        $type = isset($requestData['type']) ? $requestData['type'] : 'info';

        if (empty($title) || empty($message) || empty($target)) {
            http_response_code(400);
            echo json_encode(['error' => 'target, title, and message are required']);
            exit;
        }

        if ($target === 'all') {
            $stmt = $pdo->prepare('INSERT INTO alerts (user_id, title, message, type, bot_id) SELECT tg_id, :title, :message, :type, :bot_id_val FROM auth WHERE bot_id = :bot_id_select');
            $stmt->execute(['title' => $title, 'message' => $message, 'type' => $type, 'bot_id_val' => $botIdHeader, 'bot_id_select' => $botIdHeader]);
        } else {
            $stmt = $pdo->prepare('INSERT INTO alerts (user_id, title, message, type, bot_id) VALUES (:target, :title, :message, :type, :bot_id)');
            $stmt->execute(['target' => $target, 'title' => $title, 'message' => $message, 'type' => $type, 'bot_id' => $botIdHeader]);
        }

        echo json_encode(['success' => true]);
    } catch (Exception $e) {
        http_response_code(500);
        echo json_encode(['error' => 'Failed to send alert', 'details' => $e->getMessage()]);
    }
    exit;
}

// ─── ROUTE: /admin/orders (GET) ─────────────────────────────────
if ($route === '/admin/orders' && $method === 'GET') {
    try {
        $page = isset($requestData['page']) ? (int)$requestData['page'] : 1;
        $limit = isset($requestData['limit']) ? (int)$requestData['limit'] : 20;
        $search = isset($requestData['search']) ? $requestData['search'] : '';
        $status = isset($requestData['status']) ? $requestData['status'] : '';
        $offset = ($page - 1) * $limit;

        $whereClause = 'WHERE o.bot_id = :bot_id_order';
        $params = [
            'bot_id_order' => $botIdHeader,
            'bot_id_auth' => $botIdHeader
        ];

        if (!empty($search)) {
            $whereClause .= ' AND (o.user_id LIKE :s1 OR a.username LIKE :s2 OR a.first_name LIKE :s3 OR o.target_link LIKE :s4)';
            $params['s1'] = "%{$search}%";
            $params['s2'] = "%{$search}%";
            $params['s3'] = "%{$search}%";
            $params['s4'] = "%{$search}%";
        }

        if (!empty($status)) {
            $whereClause .= ' AND o.status = :status';
            $params['status'] = $status;
        }

        // Total
        $countQuery = "SELECT COUNT(*) as total FROM orders o LEFT JOIN auth a ON o.user_id = a.tg_id AND a.bot_id = :bot_id_auth {$whereClause}";
        $stmt = $pdo->prepare($countQuery);
        $stmt->execute($params);
        $total = (int)$stmt->fetch()['total'];

        // Rows
        $dataQuery = "
            SELECT o.*, a.username, a.first_name 
            FROM orders o 
            LEFT JOIN auth a ON o.user_id = a.tg_id AND a.bot_id = :bot_id_auth
            {$whereClause} 
            ORDER BY o.created_at DESC LIMIT :limit OFFSET :offset
        ";
        $stmt = $pdo->prepare($dataQuery);
        foreach ($params as $key => $val) {
            $stmt->bindValue(":{$key}", $val, PDO::PARAM_STR);
        }
        $stmt->bindValue(':limit', $limit, PDO::PARAM_INT);
        $stmt->bindValue(':offset', $offset, PDO::PARAM_INT);
        $stmt->execute();

        $orders = array_map('formatOrderRow', $stmt->fetchAll());

        echo json_encode(['orders' => $orders, 'total' => $total]);
    } catch (Exception $e) {
        http_response_code(500);
        echo json_encode(['error' => 'Failed to load orders', 'details' => $e->getMessage()]);
    }
    exit;
}

// ─── ROUTE: /admin/deposits (GET) ────────────────────────────────
if ($route === '/admin/deposits' && $method === 'GET') {
    try {
        $page = isset($requestData['page']) ? (int)$requestData['page'] : 1;
        $limit = isset($requestData['limit']) ? (int)$requestData['limit'] : 20;
        $search = isset($requestData['search']) ? $requestData['search'] : '';
        $status = isset($requestData['status']) ? $requestData['status'] : '';
        $offset = ($page - 1) * $limit;

        $whereClause = 'WHERE d.bot_id = :bot_id_deposit';
        $params = [
            'bot_id_deposit' => $botIdHeader,
            'bot_id_auth' => $botIdHeader
        ];

        if (!empty($search)) {
            $whereClause .= ' AND (d.user_id LIKE :s1 OR a.username LIKE :s2 OR a.first_name LIKE :s3 OR d.tx_ref LIKE :s4)';
            $params['s1'] = "%{$search}%";
            $params['s2'] = "%{$search}%";
            $params['s3'] = "%{$search}%";
            $params['s4'] = "%{$search}%";
        }

        if (!empty($status)) {
            $whereClause .= ' AND d.status = :status';
            $params['status'] = $status;
        }

        // Total
        $countQuery = "SELECT COUNT(*) as total FROM deposits d LEFT JOIN auth a ON d.user_id = a.tg_id AND a.bot_id = :bot_id_auth {$whereClause}";
        $stmt = $pdo->prepare($countQuery);
        $stmt->execute($params);
        $total = (int)$stmt->fetch()['total'];

        // Rows
        $dataQuery = "
            SELECT d.*, a.username, a.first_name 
            FROM deposits d 
            LEFT JOIN auth a ON d.user_id = a.tg_id AND a.bot_id = :bot_id_auth
            {$whereClause} 
            ORDER BY d.created_at DESC LIMIT :limit OFFSET :offset
        ";
        $stmt = $pdo->prepare($dataQuery);
        foreach ($params as $key => $val) {
            $stmt->bindValue(":{$key}", $val, PDO::PARAM_STR);
        }
        $stmt->bindValue(':limit', $limit, PDO::PARAM_INT);
        $stmt->bindValue(':offset', $offset, PDO::PARAM_INT);
        $stmt->execute();

        $deposits = array_map('formatDepositRow', $stmt->fetchAll());

        echo json_encode(['deposits' => $deposits, 'total' => $total]);
    } catch (Exception $e) {
        http_response_code(500);
        echo json_encode(['error' => 'Failed to load deposits', 'details' => $e->getMessage()]);
    }
    exit;
}

// ─── ROUTE: /admin/settings (GET / POST) ─────────────────────────
if ($route === '/admin/settings') {
    if ($method === 'GET') {
        try {
            $stmt = $pdo->prepare('SELECT setting_key, setting_value FROM settings WHERE bot_id = :bot_id');
            $stmt->execute(['bot_id' => $botIdHeader]);
            $rows = $stmt->fetchAll();
            $settings = [];
            foreach ($rows as $r) {
                $settings[$r['setting_key']] = $r['setting_value'];
            }

            echo json_encode([
                'rate_multiplier'   => isset($settings['rate_multiplier']) ? $settings['rate_multiplier'] : '55',
                'discount_percent'  => isset($settings['discount_percent']) ? $settings['discount_percent'] : '0',
                'holiday_name'      => isset($settings['holiday_name']) ? $settings['holiday_name'] : '',
                'maintenance_mode'  => isset($settings['maintenance_mode']) ? $settings['maintenance_mode'] : '0',
                'user_can_order'    => isset($settings['user_can_order']) ? $settings['user_can_order'] : '1',
                'marquee_text'      => isset($settings['marquee_text']) ? $settings['marquee_text'] : '',
                'top_services_ids'  => isset($settings['top_services_ids']) ? $settings['top_services_ids'] : '',
            ]);
        } catch (Exception $e) {
            http_response_code(500);
            echo json_encode(['error' => 'Failed to load settings', 'details' => $e->getMessage()]);
        }
    } elseif ($method === 'POST') {
        try {
            $key = isset($requestData['key']) ? $requestData['key'] : null;
            $value = isset($requestData['value']) ? $requestData['value'] : '';

            if (empty($key)) {
                http_response_code(400);
                echo json_encode(['error' => 'key is required']);
                exit;
            }

            if ($key === 'admin_password') {
                $stmt = $pdo->prepare('UPDATE admin_users SET password = :password WHERE username = :username AND bot_id = :bot_id');
                $stmt->execute(['password' => $value, 'username' => $adminUser, 'bot_id' => $botIdHeader]);
            } else {
                $stmt = $pdo->prepare('INSERT INTO settings (setting_key, bot_id, setting_value) VALUES (:key, :bot_id, :value) ON DUPLICATE KEY UPDATE setting_value = :value_update');
                $stmt->execute(['key' => $key, 'bot_id' => $botIdHeader, 'value' => $value, 'value_update' => $value]);
            }

            echo json_encode(['success' => true]);
        } catch (Exception $e) {
            http_response_code(500);
            echo json_encode(['error' => 'Failed to update setting', 'details' => $e->getMessage()]);
        }
    }
    exit;
}

// ─── ROUTE: /admin/services/custom (GET / POST) ──────────────────
if ($route === '/admin/services/custom') {
    if ($method === 'GET') {
        try {
            $stmt = $pdo->prepare('SELECT * FROM service_custom WHERE bot_id = :bot_id ORDER BY updated_at DESC');
            $stmt->execute(['bot_id' => $botIdHeader]);
            $rows = $stmt->fetchAll();
            
            // Normalize columns
            foreach ($rows as &$r) {
                $r['id'] = (int)$r['id'];
                $r['service_id'] = (int)$r['service_id'];
                $r['is_enabled'] = (bool)$r['is_enabled'];
                $r['custom_rate'] = $r['custom_rate'] !== null ? (float)$r['custom_rate'] : null;
                $r['profit_margin'] = (float)$r['profit_margin'];
            }
            echo json_encode($rows);
        } catch (Exception $e) {
            http_response_code(500);
            echo json_encode(['error' => 'Failed to load custom pricing', 'details' => $e->getMessage()]);
        }
    } elseif ($method === 'POST') {
        try {
            $serviceId = isset($requestData['service_id']) ? (int)$requestData['service_id'] : null;
            $customRate = isset($requestData['custom_rate']) ? (float)$requestData['custom_rate'] : null;
            $profitMargin = isset($requestData['profit_margin']) ? (float)$requestData['profit_margin'] : 0.0;
            $isEnabled = isset($requestData['is_enabled']) ? (int)$requestData['is_enabled'] : 1;
            $desc = isset($requestData['custom_description']) ? $requestData['custom_description'] : null;

            if (empty($serviceId)) {
                http_response_code(400);
                echo json_encode(['error' => 'service_id is required']);
                exit;
            }

            $stmt = $pdo->prepare('
                INSERT INTO service_custom (service_id, bot_id, custom_rate, profit_margin, is_enabled, custom_description, updated_at) 
                VALUES (:service_id, :bot_id, :custom_rate, :profit_margin, :is_enabled, :desc, NOW()) 
                ON DUPLICATE KEY UPDATE 
                custom_rate = :custom_rate_update,
                profit_margin = :profit_margin_update,
                is_enabled = :is_enabled_update,
                custom_description = :desc_update,
                updated_at = NOW()
            ');
            $stmt->execute([
                'service_id'           => $serviceId,
                'bot_id'               => $botIdHeader,
                'custom_rate'          => $customRate,
                'profit_margin'        => $profitMargin,
                'is_enabled'           => $isEnabled,
                'desc'                 => $desc,
                'custom_rate_update'   => $customRate,
                'profit_margin_update' => $profitMargin,
                'is_enabled_update'    => $isEnabled,
                'desc_update'          => $desc
            ]);

            echo json_encode(['success' => true]);
        } catch (Exception $e) {
            http_response_code(500);
            echo json_encode(['error' => 'Failed to update custom pricing', 'details' => $e->getMessage()]);
        }
    }
    exit;
}

// ─── ROUTE: /admin/services/custom/:serviceId (DELETE) ───────────
if (strpos($route, '/admin/services/custom/') === 0 && $method === 'DELETE') {
    try {
        $serviceId = (int)substr($route, strlen('/admin/services/custom/'));
        if (empty($serviceId)) {
            http_response_code(400);
            echo json_encode(['error' => 'serviceId required']);
            exit;
        }

        $stmt = $pdo->prepare('DELETE FROM service_custom WHERE service_id = :service_id AND bot_id = :bot_id');
        $stmt->execute(['service_id' => $serviceId, 'bot_id' => $botIdHeader]);

        echo json_encode(['success' => true]);
    } catch (Exception $e) {
        http_response_code(500);
        echo json_encode(['error' => 'Failed to delete custom pricing', 'details' => $e->getMessage()]);
    }
    exit;
}

// ─── ROUTE: /admin/services/activity (GET) ───────────────────────
if ($route === '/admin/services/activity' && $method === 'GET') {
    try {
        $stmt = $pdo->prepare('
            SELECT sc.*, a.username, a.first_name 
            FROM service_custom sc 
            LEFT JOIN auth a ON sc.updated_by = a.tg_id AND a.bot_id = :bot_id_auth
            WHERE sc.bot_id = :bot_id_sc
            ORDER BY sc.updated_at DESC LIMIT 20
        ');
        $stmt->execute(['bot_id_auth' => $botIdHeader, 'bot_id_sc' => $botIdHeader]);
        $rows = $stmt->fetchAll();
        foreach ($rows as &$r) {
            $r['id'] = (int)$r['id'];
            $r['service_id'] = (int)$r['service_id'];
            $r['is_enabled'] = (bool)$r['is_enabled'];
            $r['custom_rate'] = $r['custom_rate'] !== null ? (float)$r['custom_rate'] : null;
            $r['profit_margin'] = (float)$r['profit_margin'];
        }
        echo json_encode($rows);
    } catch (Exception $e) {
        http_response_code(500);
        echo json_encode(['error' => 'Failed to load activity', 'details' => $e->getMessage()]);
    }
    exit;
}

// ─── ROUTE: /admin/services/disabled (GET) ───────────────────────
if ($route === '/admin/services/disabled' && $method === 'GET') {
    try {
        $stmt = $pdo->prepare('SELECT * FROM service_custom WHERE is_enabled = 0 AND bot_id = :bot_id ORDER BY updated_at DESC');
        $stmt->execute(['bot_id' => $botIdHeader]);
        $rows = $stmt->fetchAll();
        foreach ($rows as &$r) {
            $r['id'] = (int)$r['id'];
            $r['service_id'] = (int)$r['service_id'];
            $r['is_enabled'] = (bool)$r['is_enabled'];
            $r['custom_rate'] = $r['custom_rate'] !== null ? (float)$r['custom_rate'] : null;
            $r['profit_margin'] = (float)$r['profit_margin'];
        }
        echo json_encode($rows);
    } catch (Exception $e) {
        http_response_code(500);
        echo json_encode(['error' => 'Failed to load disabled services', 'details' => $e->getMessage()]);
    }
    exit;
}

// ─── ROUTE: /admin/chat/sessions (GET) ───────────────────────────
if ($route === '/admin/chat/sessions' && $method === 'GET') {
    try {
        $stmt = $pdo->prepare('
            SELECT c.user_id, a.username, a.first_name, MAX(c.created_at) as last_message_at
            FROM chat_messages c
            LEFT JOIN auth a ON c.user_id = a.tg_id AND a.bot_id = :bot_id_auth
            WHERE c.bot_id = :bot_id_chat
            GROUP BY c.user_id, a.username, a.first_name
            ORDER BY last_message_at DESC
        ');
        $stmt->execute(['bot_id_auth' => $botIdHeader, 'bot_id_chat' => $botIdHeader]);
        echo json_encode($stmt->fetchAll());
    } catch (Exception $e) {
        http_response_code(500);
        echo json_encode(['error' => $e->getMessage()]);
    }
    exit;
}

// ─── ROUTE: /admin/chat/:user_id (GET / POST) ────────────────────
if (strpos($route, '/admin/chat/') === 0 && !strpos($route, '/sessions')) {
    $parts = explode('/', trim($route, '/'));
    if (count($parts) === 3) {
        $userId = $parts[2];
        
        if ($method === 'GET') {
            try {
                $stmt = $pdo->prepare('SELECT * FROM chat_messages WHERE user_id = :user_id AND bot_id = :bot_id ORDER BY created_at ASC');
                $stmt->execute(['user_id' => $userId, 'bot_id' => $botIdHeader]);
                $rows = $stmt->fetchAll();
                
                foreach ($rows as &$r) {
                    $r['id'] = (int)$r['id'];
                    $r['is_admin'] = (int)$r['is_admin'] === 1;
                }
                echo json_encode($rows);
            } catch (Exception $e) {
                http_response_code(500);
                echo json_encode(['error' => 'Failed to load messages']);
            }
        } elseif ($method === 'POST') {
            try {
                $message = isset($requestData['message']) ? $requestData['message'] : null;
                if (empty($message)) {
                    http_response_code(400);
                    echo json_encode(['error' => 'message is required']);
                    exit;
                }

                $stmt = $pdo->prepare('INSERT INTO chat_messages (user_id, message, is_admin, bot_id, created_at) VALUES (:user_id, :message, 1, :bot_id, NOW())');
                $stmt->execute(['user_id' => $userId, 'message' => $message, 'bot_id' => $botIdHeader]);

                // Create alert notification for user
                $stmt = $pdo->prepare("INSERT INTO alerts (user_id, title, message, type, bot_id) VALUES (:user_id, 'New Message', 'You have a new message from support', 'chat', :bot_id)");
                $stmt->execute(['user_id' => $userId, 'bot_id' => $botIdHeader]);

                echo json_encode(['success' => true]);
            } catch (Exception $e) {
                http_response_code(500);
                echo json_encode(['error' => 'Failed to send message', 'details' => $e->getMessage()]);
            }
        }
        exit;
    }
}

// ─── ROUTE: /admin/withdrawals (GET) ─────────────────────────────
if ($route === '/admin/withdrawals' && $method === 'GET') {
    try {
        $stmt = $pdo->prepare('
            SELECT w.*, a.username, a.first_name, a.last_name 
            FROM withdrawals w 
            LEFT JOIN auth a ON w.user_id = a.tg_id AND a.bot_id = :bot_id
            WHERE w.bot_id = :bot_id
            ORDER BY w.created_at DESC
        ');
        $stmt->execute(['bot_id' => $botIdHeader]);
        $rows = $stmt->fetchAll();
        foreach ($rows as &$r) {
            $r['id'] = (int)$r['id'];
            $r['amount'] = (float)$r['amount'];
        }
        echo json_encode(['success' => true, 'withdrawals' => $rows]);
    } catch (Exception $e) {
        http_response_code(500);
        echo json_encode(['error' => 'Failed to load withdrawals', 'details' => $e->getMessage()]);
    }
    exit;
}

// ─── ROUTE: /admin/withdrawals/approve (POST) ─────────────────────
if ($route === '/admin/withdrawals/approve' && $method === 'POST') {
    try {
        $id = isset($requestData['id']) ? (int)$requestData['id'] : null;
        if (empty($id)) {
            http_response_code(400);
            echo json_encode(['error' => 'Missing withdrawal ID']);
            exit;
        }

        $pdo->beginTransaction();

        $stmt = $pdo->prepare('SELECT * FROM withdrawals WHERE id = :id AND bot_id = :bot_id FOR UPDATE');
        $stmt->execute(['id' => $id, 'bot_id' => $botIdHeader]);
        $w = $stmt->fetch();

        if (!$w) {
            $pdo->rollBack();
            http_response_code(404);
            echo json_encode(['error' => 'Withdrawal request not found']);
            exit;
        }

        if ($w['status'] === 'done') {
            $pdo->rollBack();
            http_response_code(400);
            echo json_encode(['error' => 'Withdrawal is already completed']);
            exit;
        }

        // Update status to done
        $stmt = $pdo->prepare("UPDATE withdrawals SET status = 'done' WHERE id = :id AND bot_id = :bot_id");
        $stmt->execute(['id' => $id, 'bot_id' => $botIdHeader]);

        // Notify user via alerts
        $amtFormatted = number_format((float)$w['amount'], 2);
        $message = "Your withdrawal request of {$amtFormatted} ETB has been marked as DONE and transferred to your bank account!";
        $stmt = $pdo->prepare("INSERT INTO alerts (user_id, title, message, type, bot_id) VALUES (:user_id, 'Withdrawal Done', :msg, 'success', :bot_id)");
        $stmt->execute(['user_id' => $w['user_id'], 'msg' => $message, 'bot_id' => $botIdHeader]);

        $pdo->commit();

        echo json_encode(['success' => true]);
    } catch (Exception $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        http_response_code(500);
        echo json_encode(['error' => 'Failed to approve withdrawal', 'details' => $e->getMessage()]);
    }
    exit;
}

// ─── ROUTE: /admin/finance-stats (GET) ───────────────────────────
if ($route === '/admin/finance-stats' && $method === 'GET') {
    try {
        // 1. Revenues
        $stmt = $pdo->prepare("SELECT COALESCE(SUM(amount), 0) as totalRevenue FROM deposits WHERE status IN ('completed', 'success') AND bot_id = :bot_id");
        $stmt->execute(['bot_id' => $botIdHeader]);
        $totalRevenue = (float)$stmt->fetch()['totalRevenue'];

        $stmt = $pdo->prepare("SELECT COALESCE(SUM(amount), 0) as todayRevenue FROM deposits WHERE status IN ('completed', 'success') AND created_at >= CURDATE() AND bot_id = :bot_id");
        $stmt->execute(['bot_id' => $botIdHeader]);
        $todayRevenue = (float)$stmt->fetch()['todayRevenue'];

        $stmt = $pdo->prepare("SELECT COALESCE(SUM(amount), 0) as weeklyRevenue FROM deposits WHERE status IN ('completed', 'success') AND created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY) AND bot_id = :bot_id");
        $stmt->execute(['bot_id' => $botIdHeader]);
        $weeklyRevenue = (float)$stmt->fetch()['weeklyRevenue'];

        $stmt = $pdo->prepare("SELECT COALESCE(SUM(amount), 0) as monthlyRevenue FROM deposits WHERE status IN ('completed', 'success') AND created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY) AND bot_id = :bot_id");
        $stmt->execute(['bot_id' => $botIdHeader]);
        $monthlyRevenue = (float)$stmt->fetch()['monthlyRevenue'];

        $stmt = $pdo->prepare("SELECT COALESCE(SUM(amount), 0) as prevWeeklyRevenue FROM deposits WHERE status IN ('completed', 'success') AND created_at >= DATE_SUB(NOW(), INTERVAL 14 DAY) AND created_at < DATE_SUB(NOW(), INTERVAL 7 DAY) AND bot_id = :bot_id");
        $stmt->execute(['bot_id' => $botIdHeader]);
        $prevWeeklyRevenue = (float)$stmt->fetch()['prevWeeklyRevenue'];

        // 2. Withdrawals
        $stmt = $pdo->prepare("SELECT COALESCE(SUM(amount), 0) as totalWithdrawn FROM withdrawals WHERE status = 'done' AND bot_id = :bot_id");
        $stmt->execute(['bot_id' => $botIdHeader]);
        $totalWithdrawn = (float)$stmt->fetch()['totalWithdrawn'];

        $stmt = $pdo->prepare("SELECT COALESCE(SUM(amount), 0) as todayWithdrawals FROM withdrawals WHERE status = 'done' AND created_at >= CURDATE() AND bot_id = :bot_id");
        $stmt->execute(['bot_id' => $botIdHeader]);
        $todayWithdrawals = (float)$stmt->fetch()['todayWithdrawals'];

        $stmt = $pdo->prepare("SELECT COALESCE(SUM(amount), 0) as weeklyWithdrawals FROM withdrawals WHERE status = 'done' AND created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY) AND bot_id = :bot_id");
        $stmt->execute(['bot_id' => $botIdHeader]);
        $weeklyWithdrawals = (float)$stmt->fetch()['weeklyWithdrawals'];

        $stmt = $pdo->prepare("SELECT COALESCE(SUM(amount), 0) as monthlyWithdrawals FROM withdrawals WHERE status = 'done' AND created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY) AND bot_id = :bot_id");
        $stmt->execute(['bot_id' => $botIdHeader]);
        $monthlyWithdrawals = (float)$stmt->fetch()['monthlyWithdrawals'];

        $stmt = $pdo->prepare("SELECT COALESCE(SUM(amount), 0) as pendingWithdrawals FROM withdrawals WHERE status = 'pending' AND bot_id = :bot_id");
        $stmt->execute(['bot_id' => $botIdHeader]);
        $pendingWithdrawals = (float)$stmt->fetch()['pendingWithdrawals'];

        $stmt = $pdo->prepare("SELECT COUNT(*) as totalWithdrawalsCount FROM withdrawals WHERE bot_id = :bot_id");
        $stmt->execute(['bot_id' => $botIdHeader]);
        $totalWithdrawalsCount = (int)$stmt->fetch()['totalWithdrawalsCount'];

        $stmt = $pdo->prepare("SELECT COALESCE(SUM(amount), 0) as totalWithdrawalsSum FROM withdrawals WHERE bot_id = :bot_id");
        $stmt->execute(['bot_id' => $botIdHeader]);
        $totalWithdrawalsSum = (float)$stmt->fetch()['totalWithdrawalsSum'];

        // 3. Wallet Balance
        $stmt = $pdo->prepare("SELECT COALESCE(SUM(balance), 0) as withdrawableBalance FROM auth WHERE bot_id = :bot_id");
        $stmt->execute(['bot_id' => $botIdHeader]);
        $withdrawableBalance = (float)$stmt->fetch()['withdrawableBalance'];

        // 4. Paying Users
        $stmt = $pdo->prepare("SELECT COUNT(DISTINCT user_id) as totalPayingUsers FROM deposits WHERE status IN ('completed', 'success') AND bot_id = :bot_id");
        $stmt->execute(['bot_id' => $botIdHeader]);
        $totalPayingUsers = (int)$stmt->fetch()['totalPayingUsers'];

        // 5. Provider Costs

        $stmt = $pdo->prepare("
            SELECT o.*, sc.profit_margin, sc.custom_rate 
            FROM orders o 
            LEFT JOIN service_custom sc ON o.service_id = sc.service_id AND sc.bot_id = :bot_id_sc
            WHERE o.bot_id = :bot_id_orders
        ");
        $stmt->execute(['bot_id_sc' => $botIdHeader, 'bot_id_orders' => $botIdHeader]);
        $orders = $stmt->fetchAll();
        $providerCosts = 0.0;
        foreach ($orders as $o) {
            $costVal = isset($o['cost']) && $o['cost'] !== null ? $o['cost'] : (isset($o['charge']) ? $o['charge'] : 0.0);
            $cost = (float)$costVal;
            if ($cost <= 0) continue;

            $margin = isset($o['profit_margin']) ? (float)$o['profit_margin'] : 0.0;
            $customRate = isset($o['custom_rate']) && $o['custom_rate'] !== null ? (float)$o['custom_rate'] : null;

            if ($margin > 0) {
                $providerCosts += $cost / (1 + $margin / 100);
            } elseif ($customRate !== null && $customRate > 0) {
                $providerCosts += $cost * 0.80;
            } else {
                $providerCosts += $cost / 1.15;
            }
        }

        // 6. Growth
        $revenueGrowth = 0.0;
        if ($prevWeeklyRevenue > 0) {
            $revenueGrowth = (($weeklyRevenue - $prevWeeklyRevenue) / $prevWeeklyRevenue) * 100;
        } elseif ($weeklyRevenue > 0) {
            $revenueGrowth = 100.0;
        }

        echo json_encode([
            'success'               => true,
            'totalRevenue'          => $totalRevenue,
            'todayRevenue'          => $todayRevenue,
            'weeklyRevenue'         => $weeklyRevenue,
            'monthlyRevenue'        => $monthlyRevenue,
            'totalWithdrawn'        => $totalWithdrawn,
            'todayWithdrawals'      => $todayWithdrawals,
            'weeklyWithdrawals'     => $weeklyWithdrawals,
            'monthlyWithdrawals'    => $monthlyWithdrawals,
            'withdrawableBalance'   => $withdrawableBalance,
            'pendingWithdrawals'    => $pendingWithdrawals,
            'totalWithdrawals'      => $totalWithdrawalsSum,
            'totalWithdrawalsCount' => $totalWithdrawalsCount,
            'totalPayingUsers'      => $totalPayingUsers,
            'providerCosts'         => round($providerCosts, 2),
            'revenueGrowth'         => round($revenueGrowth, 1)
        ]);
    } catch (Exception $e) {
        http_response_code(500);
        echo json_encode(['error' => 'Failed to load finance stats', 'details' => $e->getMessage()]);
    }
    exit;
}

// Helper to send Telegram message in PHP
function sendTelegramMessagePHP($tgId, $message, $imageUrl) {
    $token = getEnvVar('CLIENT_BOT_TOKEN');
    if (empty($token)) {
        throw new Exception('CLIENT_BOT_TOKEN is not configured');
    }

    $replyMarkup = [
        'inline_keyboard' => [
            [
                [
                    'text' => 'Open App 🎵',
                    'web_app' => [
                        'url' => 'https://musical-caramel-cae47e.netlifyapp/'
                    ]
                ]
            ]
        ]
    ];

    if (!empty($imageUrl)) {
        $url = "https://api.telegram.org/bot{$token}/sendPhoto";
        $payload = [
            'chat_id' => (string)$tgId,
            'photo' => $imageUrl,
            'parse_mode' => 'HTML',
            'reply_markup' => $replyMarkup
        ];
        if (!empty($message)) {
            $payload['caption'] = $message;
        }
    } else {
        $url = "https://api.telegram.org/bot{$token}/sendMessage";
        $payload = [
            'chat_id' => (string)$tgId,
            'text' => $message ?: '',
            'parse_mode' => 'HTML',
            'reply_markup' => $replyMarkup
        ];
    }

    $res = curlRequest('POST', $url, ['Content-Type: application/json'], json_encode($payload), 10);
    if ($res['code'] < 200 || $res['code'] >= 300) {
        throw new Exception("Telegram API Error: Status {$res['code']} - {$res['body']} {$res['error']}");
    }

    $body = json_decode($res['body'], true);
    if (isset($body['ok']) && !$body['ok']) {
        throw new Exception("Telegram API Error: " . (isset($body['description']) ? $body['description'] : 'Unknown error'));
    }

    return $body;
}


// ─── ROUTE: /admin/send-telegram (POST) ─────────────────────────
if ($route === '/admin/send-telegram' && $method === 'POST') {
    try {
        $target = isset($requestData['target']) ? $requestData['target'] : null;
        $message = isset($requestData['message']) ? $requestData['message'] : null;
        $imageUrl = isset($requestData['imageUrl']) ? $requestData['imageUrl'] : null;

        if (empty($message) && empty($imageUrl)) {
            http_response_code(400);
            echo json_encode(['error' => 'Either message or imageUrl is required']);
            exit;
        }

        if (empty($target)) {
            http_response_code(400);
            echo json_encode(['error' => 'Target is required']);
            exit;
        }

        if ($target === 'all') {
            // Broadcast to all users for this bot
            $stmt = $pdo->prepare('SELECT tg_id, first_name, username FROM auth WHERE tg_id IS NOT NULL AND bot_id = :bot_id');
            $stmt->execute(['bot_id' => $botIdHeader]);
            $users = $stmt->fetchAll();
            
            $results = [];
            
            foreach ($users as $user) {
                $personalizedText = $message ?: '';
                $firstName = !empty($user['first_name']) ? $user['first_name'] : 'User';
                $username = !empty($user['username']) ? '@' . $user['username'] : '';
                $displayName = trim($firstName . ' ' . $username);
                if (empty($displayName)) {
                    $displayName = 'User ' . $user['tg_id'];
                }
                
                $personalizedText = str_ireplace('{name}', $firstName, $personalizedText);
                $personalizedText = str_ireplace('{first_name}', $firstName, $personalizedText);
                
                try {
                    sendTelegramMessagePHP($user['tg_id'], $personalizedText, $imageUrl);
                    $results[] = [
                        'tg_id' => $user['tg_id'],
                        'name' => $displayName,
                        'status' => 'success'
                    ];
                } catch (Exception $e) {
                    error_log("Failed to send Telegram message to {$user['tg_id']}: " . $e->getMessage());
                    $results[] = [
                        'tg_id' => $user['tg_id'],
                        'name' => $displayName,
                        'status' => 'failed',
                        'error' => $e->getMessage()
                    ];
                }
            }

            echo json_encode([
                'success' => true, 
                'results' => $results
            ]);
        } else {
            // Send to a single user
            $personalizedText = $message ?: '';
            try {
                $stmt = $pdo->prepare('SELECT first_name FROM auth WHERE tg_id = :tg_id AND bot_id = :bot_id LIMIT 1');
                $stmt->execute(['tg_id' => $target, 'bot_id' => $botIdHeader]);
                $user = $stmt->fetch();
                if ($user) {
                    $firstName = !empty($user['first_name']) ? $user['first_name'] : 'User';
                    $personalizedText = str_ireplace('{name}', $firstName, $personalizedText);
                    $personalizedText = str_ireplace('{first_name}', $firstName, $personalizedText);
                }
            } catch (Exception $dbErr) {
                error_log("Failed to fetch user for personalization: " . $dbErr->getMessage());
            }

            $tgRes = sendTelegramMessagePHP($target, $personalizedText, $imageUrl);

            // Save to broadcasts history so it can be managed
            $stmtB = $pdo->prepare("INSERT INTO broadcasts (message, image_url, btn_text, btn_url, bot_id, created_at) VALUES (:msg, :img, 'Open App 🎵', 'https://musical-caramel-cae47e.netlifyapp/', :bot_id, NOW())");
            $stmtB->execute([
                'msg' => $message ?: '',
                'img' => $imageUrl,
                'bot_id' => $botIdHeader
            ]);
            $broadcastId = $pdo->lastInsertId();

            if (isset($tgRes['ok']) && $tgRes['ok'] && isset($tgRes['result']['message_id'])) {
                $stmtM = $pdo->prepare("INSERT INTO broadcast_messages (broadcast_id, tg_id, telegram_message_id, status, error_message, bot_id, created_at) VALUES (:b_id, :tg, :msg_id, 'sent', NULL, :bot_id, NOW())");
                $stmtM->execute([
                    'b_id'   => $broadcastId,
                    'tg'     => $target,
                    'msg_id' => $tgRes['result']['message_id'],
                    'bot_id' => $botIdHeader
                ]);
            }

            echo json_encode(['success' => true]);
        }
    } catch (Exception $e) {
        http_response_code(500);
        echo json_encode(['error' => $e->getMessage()]);
    }
    exit;
}

// Helper to send broadcast Telegram message (with custom button text/url support)
function sendBroadcastMessagePHP($tgId, $message, $imageUrl, $btnText = 'Open App 🎵', $btnUrl = 'https://musical-caramel-cae47e.netlifyapp/') {
    $token = getEnvVar('CLIENT_BOT_TOKEN');
    if (empty($token)) {
        throw new Exception('CLIENT_BOT_TOKEN is not configured');
    }

    $replyMarkup = [
        'inline_keyboard' => [
            [
                [
                    'text' => $btnText ?: 'Open App 🎵',
                    'web_app' => [
                        'url' => $btnUrl ?: 'https://musical-caramel-cae47e.netlifyapp/'
                    ]
                ]
            ]
        ]
    ];

    if (!empty($imageUrl)) {
        $url = "https://api.telegram.org/bot{$token}/sendPhoto";
        $payload = [
            'chat_id' => (string)$tgId,
            'photo' => $imageUrl,
            'parse_mode' => 'HTML',
            'reply_markup' => $replyMarkup
        ];
        if (!empty($message)) {
            $payload['caption'] = $message;
        }
    } else {
        $url = "https://api.telegram.org/bot{$token}/sendMessage";
        $payload = [
            'chat_id' => (string)$tgId,
            'text' => $message ?: '',
            'parse_mode' => 'HTML',
            'reply_markup' => $replyMarkup
        ];
    }

    $res = curlRequest('POST', $url, ['Content-Type: application/json'], json_encode($payload), 10);
    if ($res['code'] < 200 || $res['code'] >= 300) {
        throw new Exception("Telegram API Error: Status {$res['code']} - {$res['body']} {$res['error']}");
    }

    $body = json_decode($res['body'], true);
    if (isset($body['ok']) && !$body['ok']) {
        throw new Exception("Telegram API Error: " . (isset($body['description']) ? $body['description'] : 'Unknown error'));
    }

    return $body;
}

// Helper to edit Telegram message text/caption (with custom button text/url support)
function editTelegramMessagePHP($tgId, $messageId, $newMessage, $imageUrl = null, $btnText = 'Open App 🎵', $btnUrl = 'https://musical-caramel-cae47e.netlifyapp/') {
    $token = getEnvVar('CLIENT_BOT_TOKEN');
    if (empty($token)) {
        throw new Exception('CLIENT_BOT_TOKEN is not configured');
    }

    $replyMarkup = [
        'inline_keyboard' => [
            [
                [
                    'text' => $btnText ?: 'Open App 🎵',
                    'web_app' => [
                        'url' => $btnUrl ?: 'https://musical-caramel-cae47e.netlifyapp/'
                    ]
                ]
            ]
        ]
    ];

    if (!empty($imageUrl)) {
        $url = "https://api.telegram.org/bot{$token}/editMessageCaption";
        $payload = [
            'chat_id' => (string)$tgId,
            'message_id' => (int)$messageId,
            'caption' => $newMessage,
            'parse_mode' => 'HTML',
            'reply_markup' => $replyMarkup
        ];
    } else {
        $url = "https://api.telegram.org/bot{$token}/editMessageText";
        $payload = [
            'chat_id' => (string)$tgId,
            'message_id' => (int)$messageId,
            'text' => $newMessage,
            'parse_mode' => 'HTML',
            'reply_markup' => $replyMarkup
        ];
    }

    $res = curlRequest('POST', $url, ['Content-Type: application/json'], json_encode($payload), 10);
    if ($res['code'] < 200 || $res['code'] >= 300) {
        throw new Exception("Telegram API Error: Status {$res['code']} - {$res['body']} {$res['error']}");
    }
    $body = json_decode($res['body'], true);
    if (isset($body['ok']) && !$body['ok']) {
        throw new Exception("Telegram API Error: " . (isset($body['description']) ? $body['description'] : 'Unknown error'));
    }
    return $body;
}

// Helper to delete Telegram message
function deleteTelegramMessagePHP($tgId, $messageId) {
    $token = getEnvVar('CLIENT_BOT_TOKEN');
    if (empty($token)) {
        throw new Exception('CLIENT_BOT_TOKEN is not configured');
    }

    $url = "https://api.telegram.org/bot{$token}/deleteMessage";
    $payload = [
        'chat_id' => (string)$tgId,
        'message_id' => (int)$messageId
    ];

    $res = curlRequest('POST', $url, ['Content-Type: application/json'], json_encode($payload), 10);
    if ($res['code'] < 200 || $res['code'] >= 300) {
        throw new Exception("Telegram API Error: Status {$res['code']} - {$res['body']} {$res['error']}");
    }
    $body = json_decode($res['body'], true);
    if (isset($body['ok']) && !$body['ok']) {
        throw new Exception("Telegram API Error: " . (isset($body['description']) ? $body['description'] : 'Unknown error'));
    }
    return $body;
}

// ─── ROUTE: /admin/broadcasts (GET) ─────────────────────────────
if ($route === '/admin/broadcasts' && $method === 'GET') {
    try {
        $stmt = $pdo->prepare("
            SELECT b.*, 
                   (SELECT COUNT(*) FROM broadcast_messages bm WHERE bm.broadcast_id = b.id AND bm.status = 'sent' AND bm.bot_id = :bot_id_sent) as sent_count,
                   (SELECT COUNT(*) FROM broadcast_messages bm WHERE bm.broadcast_id = b.id AND bm.status = 'failed' AND bm.bot_id = :bot_id_failed) as failed_count
            FROM broadcasts b
            WHERE b.bot_id = :bot_id_main
            ORDER BY b.created_at DESC
        ");
        $stmt->execute([
            'bot_id_sent' => $botIdHeader,
            'bot_id_failed' => $botIdHeader,
            'bot_id_main' => $botIdHeader
        ]);
        $rows = $stmt->fetchAll();
        foreach ($rows as &$r) {
            $r['id'] = (int)$r['id'];
            $r['sent_count'] = (int)$r['sent_count'];
            $r['failed_count'] = (int)$r['failed_count'];
        }
        echo json_encode($rows);
    } catch (Exception $e) {
        http_response_code(500);
        echo json_encode(['error' => 'Failed to load broadcasts', 'details' => $e->getMessage()]);
    }
    exit;
}

// ─── ROUTE: /admin/broadcasts (POST) ────────────────────────────
if ($route === '/admin/broadcasts' && $method === 'POST') {
    try {
        $message = isset($requestData['message']) ? $requestData['message'] : null;
        $imageUrl = isset($requestData['imageUrl']) ? $requestData['imageUrl'] : null;
        $btnText = isset($requestData['btnText']) ? $requestData['btnText'] : 'Open App 🎵';
        $btnUrl = isset($requestData['btnUrl']) ? $requestData['btnUrl'] : 'https://musical-caramel-cae47e.netlifyapp/';

        if (empty($message) && empty($imageUrl)) {
            http_response_code(400);
            echo json_encode(['error' => 'Either message or imageUrl is required']);
            exit;
        }

        $stmt = $pdo->prepare('INSERT INTO broadcasts (message, image_url, btn_text, btn_url, bot_id, created_at) VALUES (:msg, :img, :btn_t, :btn_u, :bot_id, NOW())');
        $stmt->execute([
            'msg'   => $message ?: '',
            'img'   => $imageUrl,
            'btn_t' => $btnText,
            'btn_u' => $btnUrl,
            'bot_id'=> $botIdHeader
        ]);
        $broadcastId = $pdo->lastInsertId();

        $stmt = $pdo->prepare('SELECT tg_id, first_name FROM auth WHERE tg_id IS NOT NULL AND bot_id = :bot_id');
        $stmt->execute(['bot_id' => $botIdHeader]);
        $users = $stmt->fetchAll();

        $sentCount = 0;
        $failedCount = 0;

        $stmtInsert = $pdo->prepare('
            INSERT INTO broadcast_messages (broadcast_id, tg_id, telegram_message_id, status, error_message, bot_id, created_at)
            VALUES (:broadcast_id, :tg_id, :msg_id, :status, :err, :bot_id, NOW())
        ');

        foreach ($users as $user) {
            $personalizedText = $message ?: '';
            $firstName = !empty($user['first_name']) ? $user['first_name'] : 'User';
            $personalizedText = str_ireplace('{name}', $firstName, $personalizedText);
            $personalizedText = str_ireplace('{first_name}', $firstName, $personalizedText);

            try {
                $tgRes = sendBroadcastMessagePHP($user['tg_id'], $personalizedText, $imageUrl, $btnText, $btnUrl);
                if (isset($tgRes['ok']) && $tgRes['ok'] && isset($tgRes['result']['message_id'])) {
                    $msgId = $tgRes['result']['message_id'];
                    $stmtInsert->execute([
                        'broadcast_id' => $broadcastId,
                        'tg_id'        => $user['tg_id'],
                        'msg_id'       => $msgId,
                        'status'       => 'sent',
                        'err'          => null,
                        'bot_id'       => $botIdHeader
                    ]);
                    $sentCount++;
                } else {
                    $stmtInsert->execute([
                        'broadcast_id' => $broadcastId,
                        'tg_id'        => $user['tg_id'],
                        'msg_id'       => 0,
                        'status'       => 'failed',
                        'err'          => 'Invalid Telegram response',
                        'bot_id'       => $botIdHeader
                    ]);
                    $failedCount++;
                }
            } catch (Exception $e) {
                $stmtInsert->execute([
                    'broadcast_id' => $broadcastId,
                    'tg_id'        => $user['tg_id'],
                    'msg_id'       => 0,
                    'status'       => 'failed',
                    'err'          => $e->getMessage(),
                    'bot_id'       => $botIdHeader
                ]);
                $failedCount++;
            }
        }

        echo json_encode([
            'success'      => true,
            'broadcast_id' => (int)$broadcastId,
            'sent_count'   => $sentCount,
            'failed_count' => $failedCount
        ]);
    } catch (Exception $e) {
        http_response_code(500);
        echo json_encode(['error' => 'Failed to create broadcast', 'details' => $e->getMessage()]);
    }
    exit;
}

// ─── ROUTE: /admin/broadcasts/:id (PUT / DELETE) ─────────────────
if (strpos($route, '/admin/broadcasts/') === 0 && strpos($route, '/messages') === false && strpos($route, '/broadcasts/messages/') === false) {
    $parts = explode('/', trim($route, '/'));
    if (count($parts) === 3 && $parts[1] === 'broadcasts') {
        $broadcastId = (int)$parts[2];

        if ($method === 'PUT') {
            try {
                $newMessage = isset($requestData['message']) ? $requestData['message'] : '';
                $newImageUrl = isset($requestData['imageUrl']) ? $requestData['imageUrl'] : null;
                $newBtnText = isset($requestData['btnText']) ? $requestData['btnText'] : 'Open App 🎵';
                $newBtnUrl = isset($requestData['btnUrl']) ? $requestData['btnUrl'] : 'https://musical-caramel-cae47e.netlifyapp/';

                $stmt = $pdo->prepare('UPDATE broadcasts SET message = :msg, image_url = :img, btn_text = :btn_t, btn_url = :btn_u WHERE id = :id AND bot_id = :bot_id');
                $stmt->execute([
                    'msg'   => $newMessage,
                    'img'   => $newImageUrl,
                    'btn_t' => $newBtnText,
                    'btn_u' => $newBtnUrl,
                    'id'    => $broadcastId,
                    'bot_id'=> $botIdHeader
                ]);

                $stmt = $pdo->prepare("SELECT tg_id, telegram_message_id, custom_message FROM broadcast_messages WHERE broadcast_id = :id AND status = 'sent' AND bot_id = :bot_id");
                $stmt->execute(['id' => $broadcastId, 'bot_id' => $botIdHeader]);
                $messages = $stmt->fetchAll();

                $updatedCount = 0;
                $failedCount = 0;

                foreach ($messages as $msg) {
                    try {
                        // If the message was customized for this specific user, don't overwrite it unless requested.
                        // Or if we do update it, use the customized message. Here we will update using their custom_message if set, otherwise fallback to global newMessage.
                        $textToEdit = !empty($msg['custom_message']) ? $msg['custom_message'] : $newMessage;

                        $stmtUser = $pdo->prepare('SELECT first_name FROM auth WHERE tg_id = :tg_id AND bot_id = :bot_id LIMIT 1');
                        $stmtUser->execute(['tg_id' => $msg['tg_id'], 'bot_id' => $botIdHeader]);
                        $u = $stmtUser->fetch();
                        $firstName = ($u && !empty($u['first_name'])) ? $u['first_name'] : 'User';

                        $personalizedText = str_ireplace('{name}', $firstName, $textToEdit);
                        $personalizedText = str_ireplace('{first_name}', $firstName, $personalizedText);

                        editTelegramMessagePHP($msg['tg_id'], $msg['telegram_message_id'], $personalizedText, $newImageUrl, $newBtnText, $newBtnUrl);
                        $updatedCount++;
                    } catch (Exception $e) {
                        $failedCount++;
                    }
                }

                echo json_encode([
                    'success'       => true,
                    'updated_count' => $updatedCount,
                    'failed_count'  => $failedCount
                ]);
            } catch (Exception $e) {
                http_response_code(500);
                echo json_encode(['error' => 'Failed to update broadcast', 'details' => $e->getMessage()]);
            }
            exit;
        }

        if ($method === 'DELETE') {
            try {
                $stmt = $pdo->prepare("SELECT tg_id, telegram_message_id FROM broadcast_messages WHERE broadcast_id = :id AND status = 'sent' AND bot_id = :bot_id");
                $stmt->execute(['id' => $broadcastId, 'bot_id' => $botIdHeader]);
                $messages = $stmt->fetchAll();

                $deletedCount = 0;
                $failedCount = 0;

                foreach ($messages as $msg) {
                    try {
                        deleteTelegramMessagePHP($msg['tg_id'], $msg['telegram_message_id']);
                        $deletedCount++;
                    } catch (Exception $e) {
                        $failedCount++;
                    }
                }

                $stmt = $pdo->prepare('DELETE FROM broadcasts WHERE id = :id AND bot_id = :bot_id');
                $stmt->execute(['id' => $broadcastId, 'bot_id' => $botIdHeader]);

                echo json_encode([
                    'success'       => true,
                    'deleted_count' => $deletedCount,
                    'failed_count'  => $failedCount
                ]);
            } catch (Exception $e) {
                http_response_code(500);
                echo json_encode(['error' => 'Failed to delete broadcast', 'details' => $e->getMessage()]);
            }
            exit;
        }
    }
}

// ─── ROUTE: /admin/broadcasts/:id/messages (GET) ────────────────
if (strpos($route, '/admin/broadcasts/') === 0 && strpos($route, '/messages') !== false) {
    $parts = explode('/', trim($route, '/'));
    if (count($parts) === 4 && $parts[1] === 'broadcasts' && $parts[3] === 'messages') {
        $broadcastId = (int)$parts[2];
        try {
            $stmt = $pdo->prepare('
                SELECT bm.*, a.first_name, a.username 
                FROM broadcast_messages bm 
                LEFT JOIN auth a ON bm.tg_id = a.tg_id AND a.bot_id = :bot_id_auth
                WHERE bm.broadcast_id = :id AND bm.bot_id = :bot_id_bm
                ORDER BY bm.created_at ASC
            ');
            $stmt->execute(['id' => $broadcastId, 'bot_id_auth' => $botIdHeader, 'bot_id_bm' => $botIdHeader]);
            $rows = $stmt->fetchAll();
            foreach ($rows as &$r) {
                $r['id'] = (int)$r['id'];
                $r['broadcast_id'] = (int)$r['broadcast_id'];
                $r['telegram_message_id'] = (int)$r['telegram_message_id'];
            }
            echo json_encode($rows);
        } catch (Exception $e) {
            http_response_code(500);
            echo json_encode(['error' => 'Failed to load broadcast messages', 'details' => $e->getMessage()]);
        }
        exit;
    }
}

// ─── ROUTE: /admin/broadcasts/messages/:msg_id (PUT / DELETE) ───
if (strpos($route, '/admin/broadcasts/messages/') === 0) {
    $parts = explode('/', trim($route, '/'));
    if (count($parts) === 4 && $parts[2] === 'messages') {
        $msgId = (int)$parts[3];

        if ($method === 'PUT') {
            try {
                $newMessage = isset($requestData['message']) ? $requestData['message'] : '';
                $newImageUrl = isset($requestData['imageUrl']) ? $requestData['imageUrl'] : null;

                $stmt = $pdo->prepare("
                    SELECT bm.*, b.btn_text, b.btn_url 
                    FROM broadcast_messages bm 
                    JOIN broadcasts b ON bm.broadcast_id = b.id 
                    WHERE bm.id = :id AND bm.status = 'sent' AND bm.bot_id = :bot_id
                ");
                $stmt->execute(['id' => $msgId, 'bot_id' => $botIdHeader]);
                $msgRecord = $stmt->fetch();

                if (!$msgRecord) {
                    http_response_code(404);
                    echo json_encode(['error' => 'Sent message record not found or already failed']);
                    exit;
                }

                // Edit on Telegram
                editTelegramMessagePHP(
                    $msgRecord['tg_id'], 
                    $msgRecord['telegram_message_id'], 
                    $newMessage, 
                    $newImageUrl, 
                    $msgRecord['btn_text'], 
                    $msgRecord['btn_url']
                );

                // Save custom message back to DB
                $stmtUpdate = $pdo->prepare('UPDATE broadcast_messages SET custom_message = :msg WHERE id = :id AND bot_id = :bot_id');
                $stmtUpdate->execute(['msg' => $newMessage, 'id' => $msgId, 'bot_id' => $botIdHeader]);

                echo json_encode(['success' => true]);
            } catch (Exception $e) {
                http_response_code(500);
                echo json_encode(['error' => 'Failed to update user message', 'details' => $e->getMessage()]);
            }
            exit;
        }

        if ($method === 'DELETE') {
            try {
                $stmt = $pdo->prepare("SELECT tg_id, telegram_message_id FROM broadcast_messages WHERE id = :id AND status = 'sent' AND bot_id = :bot_id");
                $stmt->execute(['id' => $msgId, 'bot_id' => $botIdHeader]);
                $msgRecord = $stmt->fetch();

                if ($msgRecord) {
                    deleteTelegramMessagePHP($msgRecord['tg_id'], $msgRecord['telegram_message_id']);
                }

                $stmtDel = $pdo->prepare('DELETE FROM broadcast_messages WHERE id = :id AND bot_id = :bot_id');
                $stmtDel->execute(['id' => $msgId, 'bot_id' => $botIdHeader]);

                echo json_encode(['success' => true]);
            } catch (Exception $e) {
                http_response_code(500);
                echo json_encode(['error' => 'Failed to delete user message', 'details' => $e->getMessage()]);
            }
            exit;
        }
    }
}


// ═══ RESELLER SYSTEM (Chapa + Withdrawals) ═══

// Ensure reseller tables exist
try {
    $pdo->exec("
        CREATE TABLE IF NOT EXISTS reseller_deposits (
            id INT AUTO_INCREMENT PRIMARY KEY,
            amount DECIMAL(10, 2) NOT NULL,
            tx_ref VARCHAR(255) NOT NULL UNIQUE,
            status VARCHAR(50) DEFAULT 'pending',
            chapa_tx_ref VARCHAR(255) DEFAULT NULL,
            chapa_response TEXT DEFAULT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            completed_at DATETIME DEFAULT NULL
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    ");
    $pdo->exec("
        CREATE TABLE IF NOT EXISTS admin_withdrawals (
            id INT AUTO_INCREMENT PRIMARY KEY,
            amount DECIMAL(10, 2) NOT NULL,
            bank_name VARCHAR(255) NOT NULL,
            account_number VARCHAR(255) NOT NULL,
            account_name VARCHAR(255) NOT NULL,
            status VARCHAR(50) DEFAULT 'pending',
            joadmin_request_id INT DEFAULT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    ");
} catch (Exception $e) {}


// ─── ROUTE: /admin/reseller/deposit/test-init (GET) ──────────────────
if ($route === '/admin/reseller/deposit/test-init' && $method === 'GET') {
    echo json_encode(['success' => true, 'message' => "Reseller deposit router is fully active!"]);
    exit;
}


// ─── ROUTE: /admin/reseller/deposit/init (POST) ──────────────────────
if ($route === '/admin/reseller/deposit/init' && $method === 'POST') {
    $rawAmount = isset($requestData['amount']) ? $requestData['amount'] : 0;
    $amount = (float)$rawAmount;
    
    $minDep = (int)getEnvVar('MIN_DEPOSIT', 10);
    $maxDep = (int)getEnvVar('MAX_DEPOSIT', 100000);
    
    if ($amount < $minDep) {
        http_response_code(400);
        echo json_encode(['success' => false, 'error' => "Minimum deposit is {$minDep} ETB"]);
        exit;
    }
    if ($amount > $maxDep) {
        http_response_code(400);
        echo json_encode(['success' => false, 'error' => "Maximum deposit is " . number_format($maxDep) . " ETB"]);
        exit;
    }
    
    $txRef = "RADM-" . time() . "-" . bin2hex(random_bytes(4));
    
    try {
        $stmt = $pdo->prepare("INSERT INTO reseller_deposits (amount, tx_ref, status) VALUES (:amount, :tx_ref, 'pending')");
        $stmt->execute(['amount' => $amount, 'tx_ref' => $txRef]);
        
        // Initialize with Chapa
        global $chapaSecretKey, $chapaBaseUrl, $siteUrl;
        $baseUrl = (strpos($siteUrl, 'http') === 0) ? $siteUrl : "https://{$siteUrl}";
        $chapaCallbackUrl = "{$baseUrl}/api/admin/reseller/deposit/callback";
        
        $chapaReturnUrl = isset($requestData['return_url']) ? $requestData['return_url'] : "{$baseUrl}/api/admin/reseller/deposit/callback?tx_ref={$txRef}";
        
        $payload = [
            'amount'        => $amount,
            'currency'      => 'ETB',
            'email'         => 'admin@primore.com',
            'first_name'    => 'Admin',
            'last_name'     => 'Reseller',
            'tx_ref'        => $txRef,
            'callback_url'  => $chapaCallbackUrl,
            'return_url'    => $chapaReturnUrl,
            'customization' => [
                'title'       => 'Primore Topup',
                'description' => 'Admin balance deposit'
            ]
        ];
        
        $res = curlRequest('POST', "{$chapaBaseUrl}/transaction/initialize", [
            "Authorization: Bearer {$chapaSecretKey}",
            "Content-Type: application/json"
        ], json_encode($payload), 20);
        
        $chapaData = json_decode($res['body'], true);
        $success = $res['code'] === 200 && isset($chapaData['status']) && $chapaData['status'] === 'success';
        
        if ($success && isset($chapaData['data']['checkout_url'])) {
            $checkoutUrl = $chapaData['data']['checkout_url'];
            
            $stmt = $pdo->prepare("UPDATE reseller_deposits SET status = 'initiated' WHERE tx_ref = :tx_ref");
            $stmt->execute(['tx_ref' => $txRef]);
            
            echo json_encode([
                'success'      => true,
                'checkout_url' => $checkoutUrl,
                'tx_ref'       => $txRef
            ]);
        } else {
            $stmt = $pdo->prepare("DELETE FROM reseller_deposits WHERE tx_ref = :tx_ref");
            $stmt->execute(['tx_ref' => $txRef]);
            
            http_response_code(400);
            $errMsg = 'Failed to initialize Chapa payment';
            if (isset($chapaData['message'])) {
                if (is_array($chapaData['message'])) {
                    $errMsg = json_encode($chapaData['message']);
                } else {
                    $errMsg = (string)$chapaData['message'];
                }
            }
            if (empty($errMsg) && isset($chapaData['error'])) {
                $errMsg = is_array($chapaData['error']) ? json_encode($chapaData['error']) : (string)$chapaData['error'];
            }
            echo json_encode([
                'success' => false, 
                'error' => "Chapa Error: {$errMsg}", 
                'debug' => isset($res['body']) ? $res['body'] : ''
            ]);
        }
    } catch (Exception $e) {
        http_response_code(500);
        echo json_encode(['success' => false, 'error' => 'System error: ' . $e->getMessage()]);
    }
    exit;
}


// ─── ROUTE: /admin/reseller/deposit/callback (GET / POST) ────────────
if ($route === '/admin/reseller/deposit/callback') {
    // Signature Verification (Only for POST)
    if ($_SERVER['REQUEST_METHOD'] === 'POST') {
        $headers = array_change_key_case(getallheaders(), CASE_LOWER);
        $signature = isset($headers['chapa-signature']) ? $headers['chapa-signature'] : null;
        global $chapaSecretKey;
        
        if ($signature && $chapaSecretKey) {
            $rawPost = file_get_contents('php://input');
            $hash = hash_hmac('sha256', $rawPost, $chapaSecretKey);
            if ($signature !== $hash) {
                http_response_code(401);
                echo "Forbidden";
                exit;
            }
        }
    }
    
    $txRef = isset($requestData['trx_ref']) ? $requestData['trx_ref'] : (isset($requestData['tx_ref']) ? $requestData['tx_ref'] : '');
    
    if (empty($txRef)) {
        echo json_encode(['success' => false, 'message' => 'Missing tx_ref']);
        exit;
    }
    
    try {
        $pdo->beginTransaction();
        
        $stmt = $pdo->prepare('SELECT status, amount FROM reseller_deposits WHERE tx_ref = :tx_ref FOR UPDATE');
        $stmt->execute(['tx_ref' => $txRef]);
        $depositCheck = $stmt->fetch();
        
        if (!$depositCheck) {
            $pdo->rollBack();
            echo json_encode(['success' => false, 'message' => 'Deposit not found']);
            exit;
        }
        
        if ($depositCheck['status'] === 'success') {
            $pdo->rollBack();
            echo json_encode(['success' => true, 'message' => 'Already processed']);
            exit;
        }
        
        // Verify with Chapa
        global $chapaSecretKey, $chapaBaseUrl;
        $url = "{$chapaBaseUrl}/transaction/verify/{$txRef}?_t=" . time();
        $res = curlRequest('GET', $url, [
            "Authorization: Bearer {$chapaSecretKey}",
            "Cache-Control: no-cache"
        ], null, 20);
        
        $verifyData = json_decode($res['body'], true);
        $chapaStatus = isset($verifyData['data']['status']) ? strtolower($verifyData['data']['status']) : '';
        $isSuccess = $res['code'] === 200 && ($chapaStatus === 'success' || $chapaStatus === 'paid');
        
        if ($isSuccess) {
            $verifiedAmount = isset($verifyData['data']['amount']) ? (float)$verifyData['data']['amount'] : (float)$depositCheck['amount'];
            $chapaRef = isset($verifyData['data']['reference']) ? $verifyData['data']['reference'] : '';
            $responseJson = json_encode($verifyData);
            
            // Update reseller deposit status
            $stmt = $pdo->prepare("UPDATE reseller_deposits SET status = 'success', chapa_tx_ref = :chapa_ref, chapa_response = :resp, completed_at = NOW() WHERE tx_ref = :tx_ref");
            $stmt->execute(['chapa_ref' => $chapaRef, 'resp' => $responseJson, 'tx_ref' => $txRef]);
            
            // Fetch current reseller_balance from settings
            global $adminBotId;
            $stmt = $pdo->prepare("SELECT setting_value FROM settings WHERE setting_key = 'reseller_balance' AND bot_id = :bot_id LIMIT 1");
            $stmt->execute(['bot_id' => $adminBotId]);
            $sRow = $stmt->fetch();
            
            $currentBalance = $sRow ? (float)$sRow['setting_value'] : 0.0;
            $newBalance = $currentBalance + $verifiedAmount;
            
            // Update reseller_balance setting
            $stmt = $pdo->prepare("INSERT INTO settings (setting_key, bot_id, setting_value) VALUES ('reseller_balance', :bot_id, :val) ON DUPLICATE KEY UPDATE setting_value = :val_up");
            $stmt->execute(['bot_id' => $adminBotId, 'val' => (string)$newBalance, 'val_up' => (string)$newBalance]);
            
            $pdo->commit();
            echo json_encode(['success' => true, 'message' => 'Deposit credited successfully', 'reseller_balance' => $newBalance]);
        } else {
            $realStatus = isset($verifyData['data']['status']) ? $verifyData['data']['status'] : 'pending';
            if (strtolower($realStatus) === 'failed') {
                $stmt = $pdo->prepare("UPDATE reseller_deposits SET status = 'failed' WHERE tx_ref = :tx_ref");
                $stmt->execute(['tx_ref' => $txRef]);
            }
            $pdo->commit();
            echo json_encode(['success' => false, 'message' => 'Payment verification pending or failed']);
        }
    } catch (Exception $e) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        echo json_encode(['success' => false, 'message' => 'System error: ' . $e->getMessage()]);
    }
    exit;
}


// ─── ROUTE: /admin/reseller/deposit/verify (POST / GET) ──────────────
if ($route === '/admin/reseller/deposit/verify' && ($method === 'POST' || $method === 'GET')) {
    $txRef = isset($requestData['tx_ref']) ? $requestData['tx_ref'] : null;
    
    if (empty($txRef)) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'Missing transaction reference']);
        exit;
    }
    
    try {
        $pdo->beginTransaction();
        
        $stmt = $pdo->prepare('SELECT status, amount FROM reseller_deposits WHERE tx_ref = :tx_ref FOR UPDATE');
        $stmt->execute(['tx_ref' => $txRef]);
        $depositCheck = $stmt->fetch();
        
        if (!$depositCheck) {
            $pdo->rollBack();
            echo json_encode(['success' => false, 'message' => 'Deposit record not found']);
            exit;
        }
        
        // Fetch current reseller_balance
        global $adminBotId;
        $stmt = $pdo->prepare("SELECT setting_value FROM settings WHERE setting_key = 'reseller_balance' AND bot_id = :bot_id LIMIT 1");
        $stmt->execute(['bot_id' => $adminBotId]);
        $sRow = $stmt->fetch();
        $resellerBalance = $sRow ? (float)$sRow['setting_value'] : 0.0;
        
        if ($depositCheck['status'] === 'success') {
            $pdo->rollBack();
            echo json_encode([
                'success'           => true,
                'reseller_balance'  => $resellerBalance,
                'message'           => 'Payment verified and credited.'
            ]);
            exit;
        }
        
        // Verify with Chapa
        global $chapaSecretKey, $chapaBaseUrl;
        $url = "{$chapaBaseUrl}/transaction/verify/{$txRef}?_t=" . time();
        $res = curlRequest('GET', $url, [
            "Authorization: Bearer {$chapaSecretKey}",
            "Cache-Control: no-cache"
        ], null, 20);
        
        $verifyData = json_decode($res['body'], true);
        $chapaStatus = isset($verifyData['data']['status']) ? strtolower($verifyData['data']['status']) : '';
        $isSuccess = $res['code'] === 200 && ($chapaStatus === 'success' || $chapaStatus === 'paid');
        
        if ($isSuccess) {
            $verifiedAmount = isset($verifyData['data']['amount']) ? (float)$verifyData['data']['amount'] : (float)$depositCheck['amount'];
            $chapaRef = isset($verifyData['data']['reference']) ? $verifyData['data']['reference'] : '';
            $responseJson = json_encode($verifyData);
            
            // Update status
            $stmt = $pdo->prepare("UPDATE reseller_deposits SET status = 'success', chapa_tx_ref = :chapa_ref, chapa_response = :resp, completed_at = NOW() WHERE tx_ref = :tx_ref");
            $stmt->execute(['chapa_ref' => $chapaRef, 'resp' => $responseJson, 'tx_ref' => $txRef]);
            
            // Fetch current reseller_balance from settings
            global $adminBotId;
            $stmt = $pdo->prepare("SELECT setting_value FROM settings WHERE setting_key = 'reseller_balance' AND bot_id = :bot_id LIMIT 1");
            $stmt->execute(['bot_id' => $adminBotId]);
            $sRow = $stmt->fetch();
            
            $currentBalance = $sRow ? (float)$sRow['setting_value'] : 0.0;
            $newBalance = $currentBalance + $verifiedAmount;
            
            // Update reseller_balance setting
            $stmt = $pdo->prepare("INSERT INTO settings (setting_key, bot_id, setting_value) VALUES ('reseller_balance', :bot_id, :val) ON DUPLICATE KEY UPDATE setting_value = :val_up");
            $stmt->execute(['bot_id' => $adminBotId, 'val' => (string)$newBalance, 'val_up' => (string)$newBalance]);
            
            $pdo->commit();
            
            echo json_encode([
                'success'           => true,
                'reseller_balance'  => $newBalance,
                'message'           => 'Payment verified and balance updated!'
            ]);
        } else {
            $isFailed = ($chapaStatus === 'failed' || strpos($chapaStatus, 'reject') !== false || strpos($chapaStatus, 'cancel') !== false);
            if ($isFailed) {
                $stmt = $pdo->prepare("UPDATE reseller_deposits SET status = 'failed' WHERE tx_ref = :tx_ref");
                $stmt->execute(['tx_ref' => $txRef]);
            }
            $pdo->commit();
            
            if ($isFailed) {
                echo json_encode([
                    'success' => false,
                    'message' => 'failed',
                    'error'   => 'Payment was declined or cancelled by user.'
                ]);
            } else {
                echo json_encode([
                    'success' => false,
                    'message' => 'pending',
                    'error'   => 'Payment verification pending. Please complete transaction on your phone.'
                ]);
            }
        }
    } catch (Exception $e) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        echo json_encode(['success' => false, 'message' => 'error', 'error' => 'Verification error: ' . $e->getMessage()]);
    }
    exit;
}


// ─── ROUTE: /admin/reseller/deposit/public-status (GET) ──────────────
if ($route === '/admin/reseller/deposit/public-status' && $method === 'GET') {
    $providedKey = isset($_GET['key']) ? $_GET['key'] : (isset($_SERVER['HTTP_X_API_KEY']) ? $_SERVER['HTTP_X_API_KEY'] : '');
    global $gopApiKey, $adminBotId;
    
    // Check key matches joadmin's key
    $expectedKey = getEnvVar('JOADMIN_API_KEY', $gopApiKey);
    if (empty($expectedKey) || $providedKey !== $expectedKey) {
        http_response_code(401);
        echo json_encode(['error' => 'Unauthorized']);
        exit;
    }
    
    try {
        $stmt = $pdo->prepare("SELECT setting_key, setting_value FROM settings WHERE setting_key IN ('reseller_balance', 'total_deposit') AND bot_id = :bot_id");
        $stmt->execute(['bot_id' => $adminBotId]);
        $rows = $stmt->fetchAll();
        $settings = [];
        foreach ($rows as $r) {
            $settings[$r['setting_key']] = $r['setting_value'];
        }
        
        $balance = isset($settings['reseller_balance']) ? (float)$settings['reseller_balance'] : 0.0;
        $totalDeposit = isset($settings['total_deposit']) ? (float)$settings['total_deposit'] : 0.0;
        
        echo json_encode([
            'success'          => true,
            'reseller_balance' => $balance,
            'total_deposit'    => $totalDeposit
        ]);
    } catch (Exception $e) {
        http_response_code(500);
        echo json_encode(['success' => false, 'error' => $e->getMessage()]);
    }
    exit;
}


// ─── ROUTE: /admin/reseller/withdraw-deposit (POST) ──────────────────
if ($route === '/admin/reseller/withdraw-deposit' && $method === 'POST') {
    $amount = isset($requestData['amount']) ? (float)$requestData['amount'] : 0.0;
    $bankName = isset($requestData['bank_name']) ? trim($requestData['bank_name']) : '';
    $accountNumber = isset($requestData['account_number']) ? trim($requestData['account_number']) : '';
    $accountName = isset($requestData['account_name']) ? trim($requestData['account_name']) : 'Admin';
    
    if ($amount <= 0 || empty($bankName) || empty($accountNumber)) {
        http_response_code(400);
        echo json_encode(['success' => false, 'error' => 'amount, bank_name, and account_number are required']);
        exit;
    }
    
    try {
        global $adminBotId;
        // Fetch current settings
        $stmt = $pdo->prepare("SELECT setting_key, setting_value FROM settings WHERE setting_key IN ('reseller_balance', 'total_deposit') AND bot_id = :bot_id");
        $stmt->execute(['bot_id' => $adminBotId]);
        $rows = $stmt->fetchAll();
        $settings = [];
        foreach ($rows as $r) {
            $settings[$r['setting_key']] = $r['setting_value'];
        }
        
        $balance = isset($settings['reseller_balance']) ? (float)$settings['reseller_balance'] : 0.0;
        $totalDeposit = isset($settings['total_deposit']) ? (float)$settings['total_deposit'] : 0.0;
        
        if ($balance < $amount) {
            http_response_code(400);
            echo json_encode(['success' => false, 'error' => 'Insufficient reseller balance']);
            exit;
        }
        
        $newBalance = $balance - $amount;
        
        $pdo->beginTransaction();
        try {
            // Deduct reseller balance
            $stmt = $pdo->prepare("INSERT INTO settings (setting_key, bot_id, setting_value) VALUES ('reseller_balance', :bot_id, :val) ON DUPLICATE KEY UPDATE setting_value = :val_up");
            $stmt->execute(['bot_id' => $adminBotId, 'val' => (string)$newBalance, 'val_up' => (string)$newBalance]);
            
            // Insert into admin_withdrawals
            $stmt = $pdo->prepare("INSERT INTO admin_withdrawals (amount, bank_name, account_number, account_name, status) VALUES (:amount, :bank, :acc, :name, 'pending')");
            $stmt->execute(['amount' => $amount, 'bank' => $bankName, 'acc' => $accountNumber, 'name' => $accountName]);
            $localId = $pdo->lastInsertId();
            
            $pdo->commit();
            
            // Forward request to joadmin (best effort)
            $joadminRequestId = null;
            $joadminUrl = getEnvVar('JOADMIN_SERVER_URL', 'https://padmin121.onrender.com');
            $joadminApiKey = getEnvVar('JOADMIN_API_KEY');
            $resellerId = getEnvVar('RESELLER_ID', 'primore');
            
            $payload = [
                'reseller_id'    => $resellerId,
                'local_id'       => (int)$localId,
                'amount'         => $amount,
                'bank_name'      => $bankName,
                'account_number' => $accountNumber,
                'account_name'   => $accountName
            ];
            
            $headers = [
                "x-api-key: {$joadminApiKey}",
                "Content-Type: application/json"
            ];
            
            $fwRes = curlRequest('POST', "{$joadminUrl}/api/admin/reseller/withdrawal-request", $headers, json_encode($payload), 10);
            
            if ($fwRes['code'] === 200) {
                $fwData = json_decode($fwRes['body'], true);
                if (isset($fwData['request_id'])) {
                    $joadminRequestId = (int)$fwData['request_id'];
                    
                    $stmt = $pdo->prepare("UPDATE admin_withdrawals SET joadmin_request_id = :jo_id WHERE id = :id");
                    $stmt->execute(['jo_id' => $joadminRequestId, 'id' => $localId]);
                }
            }
            
            echo json_encode([
                'success'            => true,
                'new_total_deposit'  => $totalDeposit,
                'local_id'           => (int)$localId,
                'joadmin_request_id' => $joadminRequestId,
                'status'             => 'pending',
                'message'            => 'Withdrawal request submitted. Awaiting joadmin confirmation.'
            ]);
            
        } catch (Exception $txErr) {
            $pdo->rollBack();
            throw $txErr;
        }
        
    } catch (Exception $e) {
        http_response_code(500);
        echo json_encode(['success' => false, 'error' => 'Failed to process withdrawal: ' . $e->getMessage()]);
    }
    exit;
}


// ─── ROUTE: /admin/reseller/withdrawal-history (GET) ─────────────────
if ($route === '/admin/reseller/withdrawal-history' && $method === 'GET') {
    try {
        $stmt = $pdo->query("SELECT * FROM admin_withdrawals ORDER BY created_at DESC LIMIT 50");
        $rows = $stmt->fetchAll();
        
        foreach ($rows as &$r) {
            $r['id'] = (int)$r['id'];
            $r['amount'] = (float)$r['amount'];
            $r['joadmin_request_id'] = $r['joadmin_request_id'] !== null ? (int)$r['joadmin_request_id'] : null;
        }
        
        echo json_encode([
            'success' => true,
            'withdrawals' => $rows
        ]);
    } catch (Exception $e) {
        http_response_code(500);
        echo json_encode(['success' => false, 'error' => $e->getMessage()]);
    }
    exit;
}


// ─── ROUTE: /admin/reseller/status (GET) ─────────────────────────────
if ($route === '/admin/reseller/status' && $method === 'GET') {
    try {
        global $adminBotId;
        $stmt = $pdo->prepare("SELECT setting_key, setting_value FROM settings WHERE setting_key IN ('reseller_balance', 'total_deposit', 'rate_multiplier', 'min_rate_multiplier') AND bot_id = :bot_id");
        $stmt->execute(['bot_id' => $adminBotId]);
        $rows = $stmt->fetchAll();
        
        $settings = [];
        foreach ($rows as $r) {
            $settings[$r['setting_key']] = $r['setting_value'];
        }
        
        $balance = isset($settings['reseller_balance']) ? (float)$settings['reseller_balance'] : 0.0;
        $totalDeposit = isset($settings['total_deposit']) ? (float)$settings['total_deposit'] : 0.0;
        $multiplier = isset($settings['rate_multiplier']) ? (float)$settings['rate_multiplier'] : 1.0;
        $minMultiplier = isset($settings['min_rate_multiplier']) ? (float)$settings['min_rate_multiplier'] : 1.0;
        
        echo json_encode([
            'success'              => true,
            'reseller_balance'     => $balance,
            'total_deposit'        => $totalDeposit,
            'rate_multiplier'      => $multiplier,
            'min_rate_multiplier'  => $minMultiplier
        ]);
    } catch (Exception $e) {
        http_response_code(500);
        echo json_encode(['success' => false, 'error' => $e->getMessage()]);
    }
    exit;
}


// ─── ROUTE: /admin/reseller/deposit/history (GET) ────────────────────
if ($route === '/admin/reseller/deposit/history' && $method === 'GET') {
    try {
        $stmt = $pdo->query("SELECT * FROM reseller_deposits ORDER BY created_at DESC LIMIT 50");
        $rows = $stmt->fetchAll();
        
        foreach ($rows as &$r) {
            $r['id'] = (int)$r['id'];
            $r['amount'] = (float)$r['amount'];
        }
        
        echo json_encode([
            'success' => true,
            'deposits' => $rows
        ]);
    } catch (Exception $e) {
        http_response_code(500);
        echo json_encode(['success' => false, 'error' => $e->getMessage()]);
    }
    exit;
}



