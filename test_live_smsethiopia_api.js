import { sendSmsEthiopia } from './lib/sms.js';

export async function sendWithdrawalSmsAlert(resellerName = 'Reseller', amount = 0) {
    console.log(`--- DISPATCHING LIVE SMSETHIOPIA ALERT FOR ${resellerName} (${amount} ETB) ---`);
    const smsText = `Primora Reseller Withdrawal Request: ${resellerName} - ${amount} ETB`;
    const result = await sendSmsEthiopia({
        phone: '251993960702',
        text: smsText
    });
    console.log('SMSEthiopia Raw API Response Object:');
    console.log(JSON.stringify(result, null, 2));
    return result;
}

// Support command-line execution: node test_live_smsethiopia_api.js "Reseller Name" 500
if (process.argv[1] && process.argv[1].includes('test_live_smsethiopia_api.js')) {
    const nameArg = process.argv[2] || 'Test Reseller';
    const amountArg = process.argv[3] || 100;
    sendWithdrawalSmsAlert(nameArg, amountArg).then(() => process.exit(0));
}
