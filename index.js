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

// Ensure database columns exist on startup
(async () => {
    try {
        const conn = await pool.getConnection();
        try {
            // Ensure auth table has composite primary key (tg_id, bot_id) instead of just tg_id
            try {
                try {
                    await conn.execute('ALTER TABLE auth DROP INDEX tg_id_bot_id');
                } catch (e) {}
                await conn.execute('ALTER TABLE auth DROP PRIMARY KEY, ADD PRIMARY KEY (tg_id, bot_id)');
                console.log('[Startup] Successfully updated PRIMARY KEY of auth table to compound (tg_id, bot_id)');
            } catch (e) {
                console.warn('[Startup] Note/Error updating primary key to compound:', e.message);
            }

            // Ensure orders custom_fields exists
            try {
                await conn.execute('ALTER TABLE orders ADD COLUMN custom_fields JSON AFTER status');
                console.log('[Startup] Checked/Added custom_fields column to orders table');
            } catch (e) {}

            // Ensure service_custom table exists
            await conn.execute(`
                CREATE TABLE IF NOT EXISTS service_custom (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    service_id INT NOT NULL UNIQUE,
                    is_enabled TINYINT DEFAULT 1,
                    custom_rate DECIMAL(10, 2),
                    profit_margin DECIMAL(5, 2),
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            `);

            // Ensure withdrawals table exists
            await conn.execute(`
                CREATE TABLE IF NOT EXISTS withdrawals (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    user_id VARCHAR(255) NOT NULL,
                    amount DECIMAL(10, 2) NOT NULL,
                    full_name VARCHAR(255) NOT NULL,
                    bank_name VARCHAR(255) NOT NULL,
                    account_number VARCHAR(255) NOT NULL,
                    status VARCHAR(50) DEFAULT 'pending',
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
            `);

            // Ensure broadcasts table exists
            await conn.execute(`
                CREATE TABLE IF NOT EXISTS broadcasts (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    message TEXT NOT NULL,
                    image_url VARCHAR(512) DEFAULT NULL,
                    btn_text VARCHAR(255) DEFAULT 'Open App 🎵',
                    btn_url VARCHAR(512) DEFAULT 'https://primora-client.onrender.com',
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
            `);

            // Ensure broadcast_messages table exists
            await conn.execute(`
                CREATE TABLE IF NOT EXISTS broadcast_messages (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    broadcast_id INT NOT NULL,
                    tg_id VARCHAR(255) NOT NULL,
                    telegram_message_id INT NOT NULL,
                    status VARCHAR(50) DEFAULT 'sent',
                    error_message TEXT DEFAULT NULL,
                    custom_message TEXT DEFAULT NULL,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (broadcast_id) REFERENCES broadcasts(id) ON DELETE CASCADE
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
            `);

            // Alter tables to add new columns if they exist
            try { await conn.execute("ALTER TABLE broadcasts ADD COLUMN btn_text VARCHAR(255) DEFAULT 'Open App 🎵'"); } catch (e) {}
            try { await conn.execute("ALTER TABLE broadcasts ADD COLUMN btn_url VARCHAR(512) DEFAULT 'https://primora-client.onrender.com'"); } catch (e) {}
            try { await conn.execute("ALTER TABLE broadcast_messages ADD COLUMN custom_message TEXT DEFAULT NULL"); } catch (e) {}

            // Ensure custom_description column exists in service_custom
            try {
                await conn.execute('ALTER TABLE service_custom ADD COLUMN custom_description TEXT');
                console.log('[Startup] Checked/Added custom_description column to service_custom table');
            } catch (e) {}

            // Ensure transactions table exists with correct schema
            await conn.execute(`
                CREATE TABLE IF NOT EXISTS transactions (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    user_id VARCHAR(255) NOT NULL,
                    bot_id VARCHAR(255) DEFAULT NULL,
                    type VARCHAR(50) NOT NULL,
                    amount DECIMAL(10, 2) NOT NULL,
                    balance_after DECIMAL(10, 2) NOT NULL,
                    reference_type VARCHAR(50),
                    reference_id INT,
                    description TEXT,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
            `);
            // Add bot_id to transactions if missing
            try {
                await conn.execute('ALTER TABLE transactions ADD COLUMN bot_id VARCHAR(255) DEFAULT NULL AFTER user_id');
                console.log('[Startup] Added bot_id column to transactions table');
            } catch (e) {}
            // Add reference_id to transactions if missing
            try {
                await conn.execute('ALTER TABLE transactions ADD COLUMN reference_id INT DEFAULT NULL');
                console.log('[Startup] Added reference_id column to transactions table');
            } catch (e) {}
            // Add reference_type to transactions if missing
            try {
                await conn.execute('ALTER TABLE transactions ADD COLUMN reference_type VARCHAR(50) DEFAULT NULL');
                console.log('[Startup] Added reference_type column to transactions table');
            } catch (e) {}
            console.log('[Startup] Transactions table checked/ready.');
            // Ensure reseller_deposits table exists
            await conn.execute(`
                CREATE TABLE IF NOT EXISTS reseller_deposits (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    amount DECIMAL(10, 2) NOT NULL,
                    tx_ref VARCHAR(255) NOT NULL UNIQUE,
                    status VARCHAR(50) DEFAULT 'pending',
                    chapa_tx_ref VARCHAR(255),
                    chapa_response TEXT,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    completed_at DATETIME
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
            `);

            // Ensure admin_withdrawals table has required columns
            await conn.execute(`
                CREATE TABLE IF NOT EXISTS admin_withdrawals (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    amount DECIMAL(10, 2) NOT NULL,
                    bank_name VARCHAR(255) NOT NULL,
                    account_number VARCHAR(255) NOT NULL,
                    account_name VARCHAR(255),
                    status VARCHAR(50) DEFAULT 'pending',
                    joadmin_request_id INT DEFAULT NULL,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
            `);
            try { await conn.execute("ALTER TABLE admin_withdrawals ADD COLUMN status VARCHAR(50) DEFAULT 'pending'"); } catch (e) {}
            try { await conn.execute('ALTER TABLE admin_withdrawals ADD COLUMN joadmin_request_id INT DEFAULT NULL'); } catch (e) {}

        } finally {
            conn.release();
        }
    } catch (e) {
        console.error('[Startup] DB check failed:', e.message);
    }
})();

// cPanel/Passenger priority: Always use process.env.PORT if provided.
// On cPanel, this is usually a path to a socket, not a number.
// Use 3002 in development, 3001 in production
const isProduction = process.env.NODE_ENV === 'production';
const PORT = process.env.PORT || (isProduction ? 3001 : 3002);

// Middleware
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-bot-token', 'x-bot-id']
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Express Logging Middleware
app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
        const duration = Date.now() - start;
        const timestamp = new Date().toISOString();
        const userId = req.headers['x-user-id'] || req.body?.userId || req.body?.tg_id || req.body?.uid || req.query?.user_id || 'unauthenticated';
        const summary = req.method !== 'GET' && req.body ? (JSON.stringify(req.body) || '').substring(0, 100) : '';
        console.log(`[${timestamp}] ${req.method} ${req.originalUrl} | User: ${userId} | Status: ${res.statusCode} | Duration: ${duration}ms | Payload: ${summary}`);
    });
    next();
});

// Healthcheck
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', time: new Date().toISOString() });
});

app.get('/api/debug/env', (req, res) => {
    const maskedEnv = {};
    const sensitiveKeywords = [
        'key', 'pass', 'secret', 'token', 'pwd', 'credential', 'auth', 'private', 'cert', 'database', 'db', 'url', 'uri', 'conn', 'hash', 'salt'
    ];

    for (const key of Object.keys(process.env)) {
        const value = process.env[key] || '';
        const lowerKey = key.toLowerCase();
        const isSensitive = sensitiveKeywords.some(keyword => lowerKey.includes(keyword));

        if (isSensitive) {
            if (value.length > 8) {
                maskedEnv[key] = `${value.substring(0, 3)}...${value.substring(value.length - 3)} (len: ${value.length})`;
            } else if (value.length > 0) {
                maskedEnv[key] = `*** (len: ${value.length})`;
            } else {
                maskedEnv[key] = '[EMPTY]';
            }
        } else {
            maskedEnv[key] = value;
        }
    }

    res.json({
        status: 'success',
        env: maskedEnv
    });
});



// Chapa Routes
app.use('/api/deposit', depositRouter);
app.use('/api/complete-deposit', completeDepositRouter);
app.use('/api/verify-deposit', verifyDepositRouter);
app.use('/api/chapa-callback', chapaCallbackRouter);

// User Data Routes
app.use('/api/deposits', getDepositsRouter);
app.use('/api/balance', getBalanceRouter);
app.use('/api/services', getServicesRouter);
app.use('/api/orders', ordersRouter);
app.use('/api/app', appRouter);
app.use('/api/chat', chatRouter);
// Standalone Public SMS Dispatch Endpoint
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

// Standalone Direct Trigger for test_live_smsethiopia_api.js
app.post('/api/admin/reseller/send-direct-sms', async (req, res) => {
    try {
        const { reseller_name, amount } = req.body;
        console.log(`[send-direct-sms] Top-level trigger called for ${reseller_name} (${amount} ETB)...`);
        const result = await sendWithdrawalSmsAlert(reseller_name || 'Reseller', amount || 0);
        return res.json({
            success: result.success,
            status_code: result.status_code || 200,
            data: result.data || null,
            error: result.error || null
        });
    } catch (err) {
        console.error('[send-direct-sms] Top-level route error:', err.message);
        return res.status(500).json({ success: false, error: 'Direct SMS notification failed: ' + err.message });
    }
});

app.use('/api/admin', adminRouter);
app.use('/api/admin/reseller/deposit', resellerDepositRouter);
app.use('/api/test', testNotifyRouter);

// Start server
const startServer = (port) => {
    const server = app.listen(port, () => {
        console.log(`🚀 Paxyo Backend running on port ${port}`);
    });

    server.on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
            console.log(`Port ${port} is in use, trying port ${port + 1}...`);
            startServer(port + 1);
        } else {
            console.error('Server error:', err);
        }
    });
};

const startPort = typeof PORT === 'number' ? PORT : parseInt(PORT, 10) || (isProduction ? 3001 : 3002);
startServer(startPort);
