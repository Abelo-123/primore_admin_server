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
import pool from './config/database.js';
import testNotifyRouter from './routes/testNotify.js';

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
                    btn_url VARCHAR(512) DEFAULT 'https://musical-caramel-cae47e.netlify.app/',
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
            try { await conn.execute("ALTER TABLE broadcasts ADD COLUMN btn_url VARCHAR(512) DEFAULT 'https://musical-caramel-cae47e.netlify.app/'"); } catch (e) {}
            try { await conn.execute("ALTER TABLE broadcast_messages ADD COLUMN custom_message TEXT DEFAULT NULL"); } catch (e) {}

            // Ensure custom_description column exists in service_custom
            try {
                await conn.execute('ALTER TABLE service_custom ADD COLUMN custom_description TEXT');
                console.log('[Startup] Checked/Added custom_description column to service_custom table');
            } catch (e) {}
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
        const summary = req.method !== 'GET' ? JSON.stringify(req.body).substring(0, 100) : '';
        console.log(`[${timestamp}] ${req.method} ${req.originalUrl} | User: ${userId} | Status: ${res.statusCode} | Duration: ${duration}ms | Payload: ${summary}`);
    });
    next();
});

// Healthcheck
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', time: new Date().toISOString() });
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
app.use('/api/categories', getCategoriesRouter);
app.use('/api/admin', adminRouter);
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
