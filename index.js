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
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

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
