/**
 * Auth Helper — Extract Telegram user from initData
 *
 * Parses the URL-encoded initData string sent by the Telegram Mini App
 * frontend and extracts the user's tg_id.
 *
 * Replaces the PHP pattern: parse_str($initData, $data) → json_decode($data['user'])
 */

/**
 * Extracts the Telegram user ID from the initData string.
 *
 * @param {string} initData - URL-encoded initData from Telegram SDK
 * @returns {string|null} Telegram user ID, or null if not found
 */
export function getTelegramUserId(initData) {
    if (!initData) return null;

    try {
        const params = new URLSearchParams(initData);
        const userStr = params.get('user');
        if (!userStr) return null;

        const userData = JSON.parse(userStr);
        return userData?.id ? String(userData.id) : null;
    } catch {
        return null;
    }
}

/**
 * Extracts the full Telegram user object from initData.
 *
 * @param {string} initData - URL-encoded initData from Telegram SDK
 * @returns {Object|null} User object { id, first_name, last_name, ... }
 */
export function getTelegramUser(initData) {
    if (!initData) return null;

    try {
        const params = new URLSearchParams(initData);
        const userStr = params.get('user');
        if (!userStr) return null;

        return JSON.parse(userStr);
    } catch {
        return null;
    }
}
