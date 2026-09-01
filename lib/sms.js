/**
 * SMSEthiopia Integration Helper
 * Docs: https://smsethiopia.com/#/api-reference
 */
import pool from '../config/database.js';

const DEFAULT_SMS_KEY = 'PEQBNQ8X1P6MBJH76701ZUGIX5DP7UOZ:1098';

export function formatEthiopianMsisdn(phone) {
    if (!phone) return '251993960702';
    let clean = String(phone).trim().replace(/\D/g, '');
    if (clean.startsWith('0')) {
        clean = '251' + clean.slice(1);
    } else if (!clean.startsWith('251') && clean.length === 9) {
        clean = '251' + clean;
    }
    return clean;
}

export async function getSmsApiKey() {
    if (process.env.SMS_ETHIOPIA_API_KEY && process.env.SMS_ETHIOPIA_API_KEY.trim()) {
        return process.env.SMS_ETHIOPIA_API_KEY.trim();
    }
    try {
        const [rows] = await pool.execute(
            "SELECT setting_value FROM settings WHERE setting_key IN ('sms_ethiopia_api_key', 'sms_key', 'SMS_ETHIOPIA_API_KEY') AND setting_value IS NOT NULL AND setting_value != '' LIMIT 1"
        );
        if (rows.length > 0 && rows[0].setting_value) {
            return rows[0].setting_value.trim();
        }
    } catch (e) {
        console.error('[SMS-Ethiopia] DB lookup error:', e.message);
    }
    return DEFAULT_SMS_KEY;
}

export async function sendSmsEthiopia({ phone = '251993960702', text, apiKey }) {
    let key = apiKey;
    if (!key) {
        key = await getSmsApiKey();
    }
    const msisdn = formatEthiopianMsisdn(phone);

    console.log(`[SMS-Ethiopia] Sending SMS to ${msisdn} with key [${key.slice(0, 8)}***]...`);

    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);

        const res = await fetch('https://smsethiopia.com/api/sms/send', {
            method: 'POST',
            headers: {
                'KEY': key,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                msisdn,
                text
            }),
            signal: controller.signal
        });
        clearTimeout(timeout);

        const data = await res.json().catch(() => ({}));
        console.log(`[SMS-Ethiopia] Response (${res.status}):`, JSON.stringify(data));

        const isSuccess = res.ok && (
            data.sent === true ||
            data.sent === 'true' ||
            data.sent === 1 ||
            data.status === 'success' ||
            data.status === 'accepted' ||
            data.success === true ||
            (typeof data.description === 'string' && data.description.toLowerCase().includes('accepted'))
        );

        return {
            success: isSuccess,
            status_code: res.status,
            data,
            error: isSuccess ? null : (data.error || data.message || data.description || `HTTP ${res.status} ${res.statusText}`)
        };
    } catch (err) {
        console.error('[SMS-Ethiopia] Error sending SMS:', err.message);
        return { success: false, error: err.message };
    }
}
