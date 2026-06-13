<?php
/**
 * Admin Routes — Paxyo Admin Panel Backend
 */

require_once __DIR__ . '/../config.php';
require_once __DIR__ . '/../auth.php';

$method = $_SERVER['REQUEST_METHOD'];

// Helper to sanitize database output types
function formatOrderRow($row) {
    if (isset($row['id'])) $row['id'] = (int)$row['id'];
    if (isset($row['service_id'])) $row['service_id'] = (int)$row['service_id'];
    if (isset($row['quantity'])) $row['quantity'] = (int)$row['quantity'];
    if (isset($row['cost'])) $row['cost'] = (float)$row['cost'];
    if (isset($row['charge'])) $row['charge'] = (float)$row['charge'];
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

// ─── ROUTE: /admin/dashboard (GET) ──────────────────────────────
if ($route === '/admin/dashboard' && $method === 'GET') {
    try {
        $stmt = $pdo->query('SELECT COUNT(*) as totalUsers FROM auth');
        $totalUsers = (int)$stmt->fetch()['totalUsers'];

        $stmt = $pdo->query('SELECT COUNT(*) as totalOrders FROM orders');
        $totalOrders = (int)$stmt->fetch()['totalOrders'];

        $stmt = $pdo->query("SELECT COUNT(*) as totalDeposits FROM deposits WHERE status IN ('completed', 'success')");
        $totalDeposits = (int)$stmt->fetch()['totalDeposits'];

        $stmt = $pdo->query("SELECT COALESCE(SUM(amount), 0) as totalRevenue FROM deposits WHERE status IN ('completed', 'success')");
        $totalRevenue = (float)$stmt->fetch()['totalRevenue'];

        $stmt = $pdo->query("
            SELECT o.*, a.username, a.first_name 
            FROM orders o 
            LEFT JOIN auth a ON o.user_id = a.tg_id 
            ORDER BY o.created_at DESC LIMIT 10
        ");
        $recentOrders = array_map('formatOrderRow', $stmt->fetchAll());

        $stmt = $pdo->query("
            SELECT d.*, a.username, a.first_name 
            FROM deposits d 
            LEFT JOIN auth a ON d.user_id = a.tg_id 
            ORDER BY d.created_at DESC LIMIT 10
        ");
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
        echo json_encode(['error' => 'Failed to load dashboard', 'details' => $e->getMessage()]);
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

        if (!empty($search)) {
            $whereClause = 'WHERE tg_id LIKE :s1 OR username LIKE :s2 OR first_name LIKE :s3 OR last_name LIKE :s4';
            $params['s1'] = "%{$search}%";
            $params['s2'] = "%{$search}%";
            $params['s3'] = "%{$search}%";
            $params['s4'] = "%{$search}%";
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

        $stmt = $pdo->prepare('UPDATE auth SET balance = balance + :amount WHERE tg_id = :tg_id');
        $stmt->execute(['amount' => $amount, 'tg_id' => $tgId]);

        $stmt = $pdo->prepare('SELECT balance FROM auth WHERE tg_id = :tg_id');
        $stmt->execute(['tg_id' => $tgId]);
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
            INSERT INTO transactions (user_id, type, amount, balance_after, reference_type, description, created_at)
            VALUES (:tg_id, :type, :amount, :balance_after, 'admin', 'Admin balance adjustment', NOW())
        ");
        $stmt->execute(['tg_id' => $tgId, 'type' => $txType, 'amount' => $amount, 'balance_after' => $newBalance]);

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

        $stmt = $pdo->prepare('UPDATE auth SET role = :role WHERE tg_id = :tg_id');
        $stmt->execute(['role' => $role, 'tg_id' => $tgId]);

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
            $stmt = $pdo->prepare('INSERT INTO alerts (user_id, title, message, type) SELECT tg_id, :title, :message, :type FROM auth');
            $stmt->execute(['title' => $title, 'message' => $message, 'type' => $type]);
        } else {
            $stmt = $pdo->prepare('INSERT INTO alerts (user_id, title, message, type) VALUES (:target, :title, :message, :type)');
            $stmt->execute(['target' => $target, 'title' => $title, 'message' => $message, 'type' => $type]);
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

        $whereClause = 'WHERE 1=1';
        $params = [];

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
        $countQuery = "SELECT COUNT(*) as total FROM orders o LEFT JOIN auth a ON o.user_id = a.tg_id {$whereClause}";
        $stmt = $pdo->prepare($countQuery);
        $stmt->execute($params);
        $total = (int)$stmt->fetch()['total'];

        // Rows
        $dataQuery = "
            SELECT o.*, a.username, a.first_name 
            FROM orders o 
            LEFT JOIN auth a ON o.user_id = a.tg_id 
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

        $whereClause = 'WHERE 1=1';
        $params = [];

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
        $countQuery = "SELECT COUNT(*) as total FROM deposits d LEFT JOIN auth a ON d.user_id = a.tg_id {$whereClause}";
        $stmt = $pdo->prepare($countQuery);
        $stmt->execute($params);
        $total = (int)$stmt->fetch()['total'];

        // Rows
        $dataQuery = "
            SELECT d.*, a.username, a.first_name 
            FROM deposits d 
            LEFT JOIN auth a ON d.user_id = a.tg_id 
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
            $stmt = $pdo->query('SELECT setting_key, setting_value FROM settings');
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

            $stmt = $pdo->prepare('INSERT INTO settings (setting_key, setting_value) VALUES (:key, :value) ON DUPLICATE KEY UPDATE setting_value = :value_update');
            $stmt->execute(['key' => $key, 'value' => $value, 'value_update' => $value]);

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
            $stmt = $pdo->query('SELECT * FROM service_custom ORDER BY updated_at DESC');
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
                INSERT INTO service_custom (service_id, custom_rate, profit_margin, is_enabled, custom_description, updated_at) 
                VALUES (:service_id, :custom_rate, :profit_margin, :is_enabled, :desc, NOW()) 
                ON DUPLICATE KEY UPDATE 
                custom_rate = :custom_rate_update,
                profit_margin = :profit_margin_update,
                is_enabled = :is_enabled_update,
                custom_description = :desc_update,
                updated_at = NOW()
            ');
            $stmt->execute([
                'service_id'           => $serviceId,
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

        $stmt = $pdo->prepare('DELETE FROM service_custom WHERE service_id = :service_id');
        $stmt->execute(['service_id' => $serviceId]);

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
        $stmt = $pdo->query('
            SELECT sc.*, a.username, a.first_name 
            FROM service_custom sc 
            LEFT JOIN auth a ON sc.updated_by = a.tg_id
            ORDER BY sc.updated_at DESC LIMIT 20
        ');
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
        $stmt = $pdo->query('SELECT * FROM service_custom WHERE is_enabled = 0 ORDER BY updated_at DESC');
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
        $stmt = $pdo->query('
            SELECT c.user_id, a.username, a.first_name, MAX(c.created_at) as last_message_at
            FROM chat_messages c
            LEFT JOIN auth a ON c.user_id = a.tg_id
            GROUP BY c.user_id, a.username, a.first_name
            ORDER BY last_message_at DESC
        ');
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
                $stmt = $pdo->prepare('SELECT * FROM chat_messages WHERE user_id = :user_id ORDER BY created_at ASC');
                $stmt->execute(['user_id' => $userId]);
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

                $stmt = $pdo->prepare('INSERT INTO chat_messages (user_id, message, is_admin, created_at) VALUES (:user_id, :message, 1, NOW())');
                $stmt->execute(['user_id' => $userId, 'message' => $message]);

                // Create alert notification for user
                $stmt = $pdo->prepare("INSERT INTO alerts (user_id, title, message, type) VALUES (:user_id, 'New Message', 'You have a new message from support', 'chat')");
                $stmt->execute(['user_id' => $userId]);

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
        $stmt = $pdo->query('
            SELECT w.*, a.username, a.first_name, a.last_name 
            FROM withdrawals w 
            LEFT JOIN auth a ON w.user_id = a.tg_id 
            ORDER BY w.created_at DESC
        ');
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

        $stmt = $pdo->prepare('SELECT * FROM withdrawals WHERE id = :id FOR UPDATE');
        $stmt->execute(['id' => $id]);
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
        $stmt = $pdo->prepare("UPDATE withdrawals SET status = 'done' WHERE id = :id");
        $stmt->execute(['id' => $id]);

        // Notify user via alerts
        $amtFormatted = number_format((float)$w['amount'], 2);
        $message = "Your withdrawal request of {$amtFormatted} ETB has been marked as DONE and transferred to your bank account!";
        $stmt = $pdo->prepare("INSERT INTO alerts (user_id, title, message, type) VALUES (:user_id, 'Withdrawal Done', :msg, 'success')");
        $stmt->execute(['user_id' => $w['user_id'], 'msg' => $message]);

        $pdo->commit();

        echo json_encode(['success' => true]);
    } catch (Exception $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        http_response_code(500);
        echo json_encode(['error' => 'Failed to approve withdrawal', 'details' => $e->getMessage()]);
    }
    exit;
}
