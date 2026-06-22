<?php
/**
 * Telegram sdddignature validation utility
 */

require_once __DIR__ . '/config.php';

function getTelegramUser($initData) {
    global $botToken;
    
    if (empty($initData) || !is_string($initData)) {
        return null;
    }

    try {
        // Parse theff query string parameters
        parse_str($initData, $params);
        
        $hash = isset($params['hash']) ? $params['hash'] : null;
        $userStr = isset($params['user']) ? $params['user'] : null;
        $userData = $userStr ? json_decode($userStr, true) : null;

        if (!$hash) {
            // Development/Local Fallback
            if (!$botToken) {
                return $userData;
            }
            return null;
        }

        unset($params['hash']);
        unset($params['signature']);
        
        // Sort parameters alphabetically
        ksort($params);

        // Format parameters for data check string
        $dataCheckArr = [];
        foreach ($params as $key => $val) {
            $dataCheckArr[] = "{$key}={$val}";
        }
        $dataCheckString = implode("\n", $dataCheckArr);

        if (!$botToken) {
            // Local fallback
            return $userData;
        }

        // HMAC-SHA256 signature check
        $secret = hash_hmac('sha256', $botToken, 'WebAppData', true);
        $calculatedHash = hash_hmac('sha256', $dataCheckString, $secret);

        if ($hash !== $calculatedHash) {
            // Invalid signature
            return null;
        }

        return $userData;
    } catch (Exception $e) {
        return null;
    }
}

function getTelegramUserId($initData) {
    $user = getTelegramUser($initData);
    return $user && isset($user['id']) ? (string)$user['id'] : null;
}
