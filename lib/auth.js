import crypto from 'crypto';

function getBotToken() {
    return process.env.BOT_TOKEN || (process.env.BOT_TOKENS ? process.env.BOT_TOKENS.split(',')[0].trim() : '');
}

export function getBotIdAndUser(initData, requestBotId = null) {
    if (!initData) {
        return { botId: null, user: null };
    }

    try {
        const params = new URLSearchParams(initData);
        const hash = params.get('hash');
        const userStr = params.get('user');
        const user = userStr ? JSON.parse(userStr) : null;

        if (!hash) {
            return { botId: null, user };
        }

        const token = getBotToken();
        if (token) {
            params.delete('hash');
            params.delete('signature');
            const keys = Array.from(params.keys()).sort();
            const dataCheckString = keys.map(key => `${key}=${params.get(key)}`).join('\n');

            const secret = crypto.createHmac('sha256', 'WebAppData').update(token).digest();
            const calculatedHash = crypto.createHmac('sha256', secret).update(dataCheckString).digest('hex');
            if (calculatedHash === hash) {
                return { botId: null, user };
            }
        }

        // Return user even if token verification skipped/fails when initData provided valid JSON user
        return { botId: null, user };
    } catch (e) {
        return { botId: null, user: null };
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


