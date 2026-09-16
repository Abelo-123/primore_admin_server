const botToken = process.env.WITHDRAWAL_BOT_TOKEN || '8662579997:AAHp2xw6pZLOcfHumSWfmT3BsU8NMsfMA0Y';
const adminChatIds = [5928771903, 779060335, 460529558];

const testMsg = `💸 <b>New Reseller Withdrawal Request (Primora Admin -> Paxyo Admin)</b>\n\n` +
                `👤 Reseller: <b>Primora Admin</b>\n` +
                `💵 Amount: <b>50.00 ETB</b>\n` +
                `🏦 Bank: <b>Commercial Bank of Ethiopia</b>\n` +
                `🔢 Account Number: <code>1000123456789</code>\n` +
                `🆔 Local Request ID: <code>#TEST-999</code>\n` +
                `🕒 Time: ${new Date().toLocaleString()}`;

async function runTest() {
    console.log(`Sending Telegram alert via bot token: ${botToken.substring(0, 10)}... to admins: ${adminChatIds.join(', ')}`);
    for (const chatId of adminChatIds) {
        try {
            const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chat_id: chatId,
                    text: testMsg,
                    parse_mode: 'HTML'
                })
            });
            const data = await res.json();
            console.log(`Telegram API Response for ${chatId}:`, data);
        } catch (err) {
            console.error(`❌ Error executing test for ${chatId}:`, err.message);
        }
    }
}

runTest();
