/**
 * SMSEthiopia Integration Helper
 * Docs: https://smsethiopia.com/#/api-reference
 */

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

export async function sendSmsEthiopia({ phone = '251993960702', text, apiKey }) {
    const key = apiKey || process.env.SMS_ETHIOPIA_API_KEY || '';
    const msisdn = formatEthiopianMsisdn(phone);

    console.log(`[SMS-Ethiopia] Sending SMS to ${msisdn}...`);

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
        console.log(`[SMS-Ethiopia] Response (${res.status}):`, data);
        return { success: res.ok && data.status === 'success', data };
    } catch (err) {
        console.error('[SMS-Ethiopia] Error sending SMS:', err.message);
        return { success: false, error: err.message };
    }
}
