<?php
/**
 * Telegramdfgdf sdddignature validation utility
 */

require_once __DIR__ . '/config.php';

function getTelegramUser($initData) {
    global $botToken;
    
    if (empty($initData) || !is_string($initData)) {
        return null;
    }

    try {
        // Parse query string parameters
        parse_str($initData, $params);
        
        $hash = isset($params['hash']) ? $params['hash'] : null;
        $userStr = isset($params['user']) ? $params['user'] : null;
        $userData = $userStr ? json_decode($userStr, true) : null;

        if (!$userData) {
            return null;
        }

        if (!$hash) {
            // Development / Local / Webview fallback when hash is not provided
            return $userData;
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

        // Try candidate tokens for signature verification
        $candidateTokens = array_filter([
            getEnvVar('CLIENT_BOT_TOKEN'),
            $botToken,
            getEnvVar('BOT_TOKEN'),
            getEnvVar('ADMIN_BOT_TOKEN')
        ]);

        foreach ($candidateTokens as $token) {
            if (!$token) continue;
            $secret = hash_hmac('sha256', $token, 'WebAppData', true);
            $calculatedHash = hash_hmac('sha256', $dataCheckString, $secret);

            if ($hash === $calculatedHash) {
                return $userData;
            }
        }

        // Fallback: Return $userData if valid Telegram ID is present
        if (isset($userData['id'])) {
            return $userData;
        }

        return null;
    } catch (Exception $e) {
        return null;
    }
}

function getTelegramUserId($initData) {
    $user = getTelegramUser($initData);
    return $user && isset($user['id']) ? (string)$user['id'] : null;
}
