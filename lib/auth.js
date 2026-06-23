import crypto from 'crypto';

const botTokens = {};
let primaryBotId = 'default_bot';

function loadBotTokens() {
    const rawTokens = process.env.BOT_TOKENS;
    if (rawTokens) {
        const pairs = rawTokens.split(',');
        for (const pair of pairs) {
            const trimmed = pair.trim();
            if (!trimmed) continue;
            if (trimmed.includes(':')) {
                const parts = trimmed.split(':');
                const botId = parts[0].trim();
                botTokens[botId] = trimmed;
            }
        }
    }

    const singleToken = process.env.BOT_TOKEN;
    if (singleToken && singleToken.includes(':')) {
        const parts = singleToken.split(':');
        const botId = parts[0].trim();
        if (!botTokens[botId]) {
            botTokens[botId] = singleToken;
        }
    }

    const keys = Object.keys(botTokens);
    if (keys.length > 0) {
        primaryBotId = keys[0];
    }
}

// Initial load
loadBotTokens();

export function getBotIdAndUser(initData, requestBotId = null) {
    loadBotTokens();

    if (!initData) {
        return { botId: requestBotId || primaryBotId, user: null };
    }

    try {
        const params = new URLSearchParams(initData);
        const hash = params.get('hash');
        const userStr = params.get('user');
        const user = userStr ? JSON.parse(userStr) : null;

        if (!hash) {
            return { botId: requestBotId || primaryBotId, user };
        }

        // Verify signature
        params.delete('hash');
        params.delete('signature');
        const keys = Array.from(params.keys()).sort();
        const dataCheckString = keys.map(key => `${key}=${params.get(key)}`).join('\n');

        let isValid = false;
        let matchedBotId = null;

        for (const [botId, token] of Object.entries(botTokens)) {
            const secret = crypto.createHmac('sha256', 'WebAppData').update(token).digest();
            const calculatedHash = crypto.createHmac('sha256', secret).update(dataCheckString).digest('hex');
            if (calculatedHash === hash) {
                isValid = true;
                matchedBotId = botId;
                break;
            }
        }

        if (isValid) {
            return { botId: requestBotId || matchedBotId, user };
        }

        if (Object.keys(botTokens).length === 0) {
            return { botId: requestBotId || primaryBotId, user };
        }

        return { botId: null, user: null };
    } catch (e) {
        return { botId: requestBotId || primaryBotId, user: null };
    }
}

export function getTelegramUserId(initData, requestBotId = null) {
    const { user } = getBotIdAndUser(initData, requestBotId);
    return user?.id ? String(user.id) : null;
}

export function getTelegramUser(initData, requestBotId = null) {
    const { user } = getBotIdAndUser(initData, requestBotId);
    return user;
}

