<?php
/**
 * Chat Support Routes
 */

require_once __DIR__ . '/../config.php';
require_once __DIR__ . '/../auth.php';

$initData = isset($requestData['initData']) ? $requestData['initData'] : '';
$action = isset($requestData['action']) ? $requestData['action'] : '';
$message = isset($requestData['message']) ? $requestData['message'] : '';

$tgId = getTelegramUserId($initData);
if (!$tgId) {
    http_response_code(401);
    echo json_encode(['success' => false, 'error' => 'Not authenticated']);
    exit;
}

try {
    if ($action === 'send') {
        if (empty($message)) {
            echo json_encode(['success' => false, 'error' => 'Message content is empty']);
            exit;
        }
        
        $stmt = $pdo->prepare('INSERT INTO chat_messages (user_id, message, is_admin, created_at) VALUES (:user_id, :message, 0, NOW())');
        $stmt->execute(['user_id' => $tgId, 'message' => $message]);
        
        // Notify admin bot
        $firstName = 'User';
        try {
            $stmtAuth = $pdo->prepare('SELECT first_name FROM auth WHERE tg_id = :tg_id LIMIT 1');
            $stmtAuth->execute(['tg_id' => $tgId]);
            $userRow = $stmtAuth->fetch();
            if ($userRow && !empty($userRow['first_name'])) {
                $firstName = $userRow['first_name'];
            }
        } catch (Exception $e) {
            // Ignore DB error
        }

        $botToken = '8662579997:AAHp2xw6pZLOcfHumSWfmT3BsU8NMsfMA0Y';
        $adminUserIds = [5928771903, 779060335, 460529558];
        $telegramText = "💬 Chat: {$firstName} ({$tgId}) - \"{$message}\"";
        
        foreach ($adminUserIds as $adminId) {
            $url = "https://api.telegram.org/bot{$botToken}/sendMessage";
            $payload = [
                'chat_id' => (string)$adminId,
                'text' => $telegramText,
                'parse_mode' => 'HTML'
            ];
            curlRequest('POST', $url, ['Content-Type: application/json'], json_encode($payload), 5);
        }

        echo json_encode(['success' => true]);
        
    } elseif ($action === 'fetch') {
        $stmt = $pdo->prepare('SELECT * FROM chat_messages WHERE user_id = :user_id ORDER BY created_at ASC LIMIT 100');
        $stmt->execute(['user_id' => $tgId]);
        $rows = $stmt->fetchAll();
        
        // Normalize outputs
        foreach ($rows as &$r) {
            $r['id'] = (int)$r['id'];
            $r['is_admin'] = (int)$r['is_admin'];
        }
        
        echo json_encode(['success' => true, 'messages' => $rows]);
    } else {
        echo json_encode(['success' => false, 'error' => 'Invalid action']);
    }
} catch (Exception $e) {
    if ($action === 'fetch') {
        echo json_encode(['success' => true, 'messages' => []]);
    } else {
        http_response_code(500);
        echo json_encode(['success' => false, 'error' => $e->getMessage()]);
    }
}
exit;
