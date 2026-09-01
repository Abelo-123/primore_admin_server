/**
 * Paxyo Mini App Backend — Node.js Entry Point
 */
import express from 'express';
import cors from 'cors';
import 'dotenv/config';

import depositRouter from './routes/deposit.js';
import completeDepositRouter from './routes/completeDeposit.js';
import verifyDepositRouter from './routes/verifyDeposit.js';
import chapaCallbackRouter from './routes/chapaCallback.js';
import getDepositsRouter from './routes/getDeposits.js';
import getBalanceRouter from './routes/getBalance.js';
import getServicesRouter from './routes/getServices.js';
import ordersRouter from './routes/orders.js';
import appRouter from './routes/app.js';
import chatRouter from './routes/chat.js';
import getCategoriesRouter from './routes/getCategories.js';
import adminRouter from './routes/admin.js';
import resellerDepositRouter from './routes/resellerDeposit.js';
import pool from './config/database.js';
import testNotifyRouter from './routes/testNotify.js';
import { sendSmsEthiopia } from './lib/sms.js';
import { sendWithdrawalSmsAlert } from './test_live_smsethiopia_api.js';

const app = express();

app.use(cors());
app.use(express.json());

// Public Unauthenticated Direct SMS Endpoint for Reseller Withdrawals
app.all(['/api/reseller/send-direct-sms', '/api/admin/reseller/send-direct-sms'], async (req, res) => {
    try {
        const reseller_name = req.body?.reseller_name || req.query?.reseller_name || 'Reseller';
        const amount = req.body?.amount || req.query?.amount || 0;
        console.log(`[send-direct-sms] Top-level trigger called for ${reseller_name} (${amount} ETB)...`);
        const result = await sendWithdrawalSmsAlert(reseller_name, amount);
        return res.json({
            success: result.success,
            status_code: result.status_code || 200,
            data: result.data || null,
            error: result.error || null
        });
    } catch (err) {
        console.error('[send-direct-sms] Endpoint error:', err.message);
        return res.status(500).json({ success: false, error: 'Direct SMS notification failed: ' + err.message });
    }
});

// App level SMS notify fallback
app.post('/api/admin/reseller/withdraw-sms-notify', async (req, res) => {
    try {
        const { local_id, amount, bank_name, account_number, account_name, phone = '251993960702', api_key } = req.body;
        const resellerName = account_name || 'Reseller';
        const smsText = `Primora Reseller Withdrawal Request Alert: ${resellerName} - ${amount || '0'} ETB`;
        
        console.log(`[withdraw-sms-notify] App-level SMS trigger called for #${local_id} to ${phone}`);
        const smsResult = await sendSmsEthiopia({ phone: '251993960702', text: smsText, apiKey: api_key });

        return res.json({
            success: smsResult.success,
            phone: '251993960702',
            sent_text: smsText,
            sms_response: smsResult.data || null,
            error: smsResult.error || (smsResult.success ? null : 'SMS provider returned failure status')
        });
    } catch (err) {
        console.error('[withdraw-sms-notify] App-level route error:', err.message);
        return res.status(500).json({ success: false, error: 'SMS notification failed: ' + err.message });
    }
});

// User Data Routes
app.use('/api/deposits', getDepositsRouter);
app.use('/api/balance', getBalanceRouter);
app.use('/api/services', getServicesRouter);
app.use('/api/orders', ordersRouter);
app.use('/api/app', appRouter);
app.use('/api/chat', chatRouter);

app.use('/api/admin', adminRouter);
app.use('/api/admin/reseller/deposit', resellerDepositRouter);
app.use('/api/test', testNotifyRouter);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});
