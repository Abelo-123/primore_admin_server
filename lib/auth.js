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

export function getBotIdAndUser(initData) {
    loadBotTokens();

    if (!initData) {
        return { botId: primaryBotId, user: null };
    }

    try {
        const params = new URLSearchParams(initData);
        const hash = params.get('hash');
        const userStr = params.get('user');
        const user = userStr ? JSON.parse(userStr) : null;

        if (!hash) {
            return { botId: primaryBotId, user };
        }

        // Verify signature
        params.delete('hash');
        const keys = Array.from(params.keys()).sort();
        const dataCheckString = keys.map(key => `${key}=${params.get(key)}`).join('\n');

        for (const [botId, token] of Object.entries(botTokens)) {
            const secret = crypto.createHmac('sha256', 'WebAppData').update(token).digest();
            const calculatedHash = crypto.createHmac('sha256', secret).update(dataCheckString).digest('hex');
            if (calculatedHash === hash) {
                return { botId, user };
            }
        }

        if (Object.keys(botTokens).length === 0) {
            return { botId: primaryBotId, user };
        }

        return { botId: null, user: null };
    } catch (e) {
        return { botId: primaryBotId, user: null };
    }
}

export function getTelegramUserId(initData) {
    const { user } = getBotIdAndUser(initData);
    return user?.id ? String(user.id) : null;
}

export function getTelegramUser(initData) {
    const { user } = getBotIdAndUser(initData);
    return user;
}

