/**
 * Admin Routes — Primora Admin Panel Backend (Single-Bot)
 *
 * Provides JWT-like token auth and CRUD endpoints for:
 * - Dashboard statistics
 * - User management (list, balance, role)
 * - Order history (all users)
 * - Deposit history & manual deposit resolution
 * - Settings management
 * - Reseller balance & operations
 * - Custom pricing & service controls
 * - Support chat & broadcasts
 */
import { Router } from 'express';
import pool from '../config/database.js';
import { sendSmsEthiopia } from '../lib/sms.js';
import { sendWithdrawalSmsAlert } from '../test_live_smsethiopia_api.js';
import { notifyDeposit } from '../lib/notify.js';

const router = Router();

function getCleanJoadminUrl() {
    let url = process.env.JOADMIN_SERVER_URL || 'https://padmin121-1.onrender.com';
    if (url.includes('padmin121.onrender.com') && !url.includes('padmin121-1.onrender.com')) {
        url = url.replace('padmin121.onrender.com', 'padmin121-1.onrender.com');
    }
    return url.replace(/\/+$/, '');
}
const JOADMIN_SERVER_URL = getCleanJoadminUrl();

function getJoadminApiKey() {
    return (process.env.JOADMIN_API_KEY || process.env.GODOFPANEL_API_KEY || '7aed775ad8b88b50a1706db2f35c5eaf').trim();
}
const RESELLER_ID = process.env.RESELLER_ID || 'primore';
const PRIMORA_SERVER_URL = process.env.SITE_URL || 'https://primore-admin-server.onrender.com';

// Helper to get effective admin password (DB override > env)
async function getEffectiveAdminPassword() {
    try {
        const [rows] = await pool.execute(
            "SELECT setting_value FROM settings WHERE setting_key = 'admin_password' LIMIT 1"
        );
        if (rows.length > 0 && rows[0].setting_value) {
            return rows[0].setting_value;
        }
    } catch (e) {
        console.error('[getEffectiveAdminPassword] DB error:', e.message);
    }
    return process.env.ADMIN_PASSWORD || 'primora2026';
}

// ─── POST /reseller/withdraw-sms-notify — Dedicated SMSEthiopia debug endpoint (Unauthenticated) ─
router.post('/reseller/withdraw-sms-notify', async (req, res) => {
    try {
        const { local_id, amount, bank_name, account_number, account_name, phone = '251993960702', api_key } = req.body;
        const resellerName = account_name || 'Reseller';
        const smsText = `Primora Reseller Withdrawal Request Alert: ${resellerName} - ${amount || '0'} ETB`;

        console.log(`[reseller/withdraw-sms-notify] Standalone SMS trigger requested for #${local_id} to ${phone}`);

        const smsResult = await sendSmsEthiopia({
            phone: '251993960702',
            text: smsText
        });

        return res.json({
            success: smsResult.success,
            phone,
            sent_text: smsText,
            sms_response: smsResult.data || null,
            error: smsResult.error || (smsResult.success ? null : 'SMS provider returned failure status')
        });
    } catch (err) {
        console.error('[admin/reseller/withdraw-sms-notify]', err);
        return res.status(500).json({ success: false, error: 'SMS notification failed: ' + err.message });
    }
});

// ─── GET /sms-health — Production SMS smoke test ─
router.get('/sms-health', async (req, res) => {
    try {
        console.log('[sms-health] Firing sendWithdrawalSmsAlert smoke test...');
        const result = await sendWithdrawalSmsAlert('Health Check', 1);
        return res.json({
            success: result.success,
            data: result.data,
            error: result.error,
            message: result.success ? 'SMS dispatched successfully from production server' : 'SMS dispatch failed'
        });
    } catch (err) {
        console.error('[sms-health] Error:', err.message);
        return res.status(500).json({ success: false, error: err.message });
    }
});

// ─── POST /reseller/send-direct-sms ─
router.post('/reseller/send-direct-sms', async (req, res) => {
    try {
        const { reseller_name, amount } = req.body;
        console.log(`[reseller/send-direct-sms] Directly calling sendWithdrawalSmsAlert for ${reseller_name} (${amount} ETB)...`);
        const result = await sendWithdrawalSmsAlert(reseller_name || 'Reseller', amount || 0);
        return res.json({
            success: result.success,
            data: result.data,
            error: result.error
        });
    } catch (err) {
        console.error('[admin/reseller/send-direct-sms]', err);
        return res.status(500).json({ success: false, error: 'Direct SMS notification failed: ' + err.message });
    }
});

// Middleware to check admin password auth
router.use(async (req, res, next) => {
    // Public paths — no auth needed
    if (req.path === '/login' || req.path === '/reseller/withdrawal/confirm' || req.path === '/reseller/public-status' || req.path.includes('/reseller/withdraw-sms-notify') || req.path.includes('/reseller/send-direct-sms') || req.path === '/sms-health') {
        return next();
    }

    const authHeader = req.headers.authorization || '';
    const adminPass = await getEffectiveAdminPassword();

    let providedPass = '';
    const match = authHeader.match(/Bearer\s+(.*)$/i);
    if (match) {
        providedPass = match[1];
        if (providedPass.includes(':')) {
            const parts = providedPass.split(':');
            if (parts.length >= 4) {
                providedPass = parts[1];
            } else if (parts.length === 2) {
                providedPass = parts[1];
            }
        }
    }

    if (!providedPass || providedPass !== adminPass) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
});

// Login endpoint
router.post('/login', async (req, res) => {
    const { password } = req.body;
    const adminPass = await getEffectiveAdminPassword();
    if (password === adminPass) {
        return res.json({ success: true, token: adminPass });
    } else {
        return res.status(401).json({ success: false, error: 'Invalid password' });
    }
});

// ─── Dashboard ──────────────────────────────────────────────────
router.get('/dashboard', async (req, res) => {
    try {
        const [[{ totalUsers }]] = await pool.execute('SELECT COUNT(*) as totalUsers FROM auth');
        const [[{ totalOrders }]] = await pool.execute('SELECT COUNT(*) as totalOrders FROM orders');
        const [[{ totalDeposits }]] = await pool.execute("SELECT COUNT(*) as totalDeposits FROM deposits WHERE status IN ('completed', 'success')");
        const [[{ totalRevenue }]] = await pool.execute("SELECT COALESCE(SUM(amount), 0) as totalRevenue FROM deposits WHERE status IN ('completed', 'success')");

        const [recentOrders] = await pool.execute(`
            SELECT o.*, a.username, a.first_name 
            FROM orders o 
            LEFT JOIN auth a ON o.user_id = a.tg_id
            ORDER BY o.created_at DESC LIMIT 10
        `);

        const [recentDeposits] = await pool.execute(`
            SELECT d.*, a.username, a.first_name 
            FROM deposits d 
            LEFT JOIN auth a ON d.user_id = a.tg_id
            ORDER BY d.created_at DESC LIMIT 10
        `);

        const formattedRecentOrders = recentOrders.map(o => {
            const val = o.cost !== undefined && o.cost !== null ? parseFloat(o.cost) : (o.charge !== undefined && o.charge !== null ? parseFloat(o.charge) : 0);
            return {
                ...o,
                cost: val,
                charge: val
            };
        });

        return res.json({
            totalUsers: Number(totalUsers),
            totalOrders: Number(totalOrders),
            totalDeposits: Number(totalDeposits),
            totalRevenue: Number(totalRevenue),
            recentOrders: formattedRecentOrders,
            recentDeposits,
        });
    } catch (err) {
        console.error('[admin/dashboard]', err);
        return res.status(500).json({ error: 'Failed to load dashboard' });
    }
});

// ─── Users ──────────────────────────────────────────────────────
router.get('/users', async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const search = req.query.search || '';
        const sortBy = req.query.sortBy || 'last_login';
        const sortOrder = req.query.sortOrder || 'desc';
        const offset = (page - 1) * limit;

        let whereClause = 'WHERE 1=1';
        let params = [];

        if (search) {
            whereClause += ' AND (tg_id LIKE ? OR username LIKE ? OR first_name LIKE ? OR last_name LIKE ?)';
            const s = `%${search}%`;
            params.push(s, s, s, s);
        }

        const username = req.query.username || '';
        if (username) {
            whereClause += ' AND username LIKE ?';
            params.push(`%${username}%`);
        }

        const validSortColumns = {
            recent_registration: 'created_at',
            big_balance: 'balance',
            total_spent: 'total_spent',
            recent_active: 'last_login',
            last_deposit: 'last_deposit',
            last_order: 'last_order',
        };
        const sortColumn = validSortColumns[sortBy] || 'last_login';
        const orderDir = sortOrder === 'asc' ? 'ASC' : 'DESC';

        const [[{ total }]] = await pool.execute(
            `SELECT COUNT(*) as total FROM auth ${whereClause}`, params
        );

        const [users] = await pool.execute(
            `SELECT * FROM auth ${whereClause} ORDER BY ${sortColumn} ${orderDir} LIMIT ? OFFSET ?`,
            [...params, String(limit), String(offset)]
        );

        return res.json({ users, total: Number(total) });
    } catch (err) {
        console.error('[admin/users]', err);
        return res.status(500).json({ error: 'Failed to load users' });
    }
});

router.post('/users/balance', async (req, res) => {
    try {
        const { tg_id, amount } = req.body;
        if (!tg_id || amount === undefined) {
            return res.status(400).json({ error: 'tg_id and amount are required' });
        }

        await pool.execute('UPDATE auth SET balance = balance + ? WHERE tg_id = ?', [amount, tg_id]);
        const [[user]] = await pool.execute('SELECT balance FROM auth WHERE tg_id = ?', [tg_id]);

        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        const txType = amount >= 0 ? 'bonus' : 'refund';
        await pool.execute(
            `INSERT INTO transactions (user_id, type, amount, balance_after, reference_type, description, created_at)
             VALUES (?, ?, ?, ?, 'admin', 'Admin balance adjustment', NOW())`,
            [tg_id, txType, amount, user.balance]
        );

        return res.json({ success: true, newBalance: parseFloat(user.balance) });
    } catch (err) {
        console.error('[admin/users/balance]', err);
        return res.status(500).json({ error: 'Failed to update balance' });
    }
});

router.post('/users/role', async (req, res) => {
    try {
        const { tg_id, role } = req.body;
        if (!tg_id || !role) {
            return res.status(400).json({ error: 'tg_id and role are required' });
        }

        await pool.execute('UPDATE auth SET role = ? WHERE tg_id = ?', [role, tg_id]);
        return res.json({ success: true });
    } catch (err) {
        console.error('[admin/users/role]', err);
        return res.status(500).json({ error: 'Failed to update role' });
    }
});

// ─── Alerts / Messaging ─────────────────────────────────────────
router.post('/alerts', async (req, res) => {
    try {
        const { target, title, message, type = 'info' } = req.body;

        if (!title || !message || !target) {
            return res.status(400).json({ error: 'target, title, and message are required' });
        }

        if (target === 'all') {
            await pool.execute(
                `INSERT INTO alerts (user_id, title, message, type)
                 SELECT tg_id, ?, ?, ? FROM auth`,
                [title, message, type]
            );
        } else {
            await pool.execute(
                'INSERT INTO alerts (user_id, title, message, type) VALUES (?, ?, ?, ?)',
                [target, title, message, type]
            );
        }

        return res.json({ success: true });
    } catch (err) {
        console.error('[admin/alerts]', err);
        return res.status(500).json({ error: 'Failed to send alert' });
    }
});

// ─── Orders ─────────────────────────────────────────────────────
router.get('/orders', async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const search = req.query.search || '';
        const status = req.query.status || '';
        const offset = (page - 1) * limit;

        let whereClause = 'WHERE 1=1';
        let params = [];

        if (search) {
            whereClause += ' AND (o.user_id LIKE ? OR a.username LIKE ? OR a.first_name LIKE ? OR o.target_link LIKE ?)';
            const s = `%${search}%`;
            params.push(s, s, s, s);
        }

        if (status) {
            whereClause += ' AND o.status = ?';
            params.push(status);
        }

        const [[{ total }]] = await pool.execute(
            `SELECT COUNT(*) as total FROM orders o LEFT JOIN auth a ON o.user_id = a.tg_id ${whereClause}`, params
        );

        const [orders] = await pool.execute(
            `SELECT o.*, a.username, a.first_name 
             FROM orders o 
             LEFT JOIN auth a ON o.user_id = a.tg_id
             ${whereClause} 
             ORDER BY o.created_at DESC LIMIT ? OFFSET ?`,
            [...params, String(limit), String(offset)]
        );

        const formattedOrders = orders.map(o => {
            const val = o.cost !== undefined && o.cost !== null ? parseFloat(o.cost) : (o.charge !== undefined && o.charge !== null ? parseFloat(o.charge) : 0);
            return {
                ...o,
                cost: val,
                charge: val
            };
        });

        return res.json({ orders: formattedOrders, total: Number(total) });
    } catch (err) {
        console.error('[admin/orders]', err);
        return res.status(500).json({ error: 'Failed to load orders' });
    }
});

// ─── Deposits ───────────────────────────────────────────────────
router.get('/deposits', async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const search = req.query.search || '';
        const status = req.query.status || '';
        const offset = (page - 1) * limit;

        let whereClause = 'WHERE 1=1';
        let params = [];

        if (search) {
            whereClause += ' AND (d.user_id LIKE ? OR a.username LIKE ? OR a.first_name LIKE ? OR d.tx_ref LIKE ?)';
            const s = `%${search}%`;
            params.push(s, s, s, s);
        }

        if (status) {
            whereClause += ' AND d.status = ?';
            params.push(status);
        }

        const [[{ total }]] = await pool.execute(
            `SELECT COUNT(*) as total FROM deposits d LEFT JOIN auth a ON d.user_id = a.tg_id ${whereClause}`, params
        );

        const [deposits] = await pool.execute(
            `SELECT d.*, a.username, a.first_name 
             FROM deposits d 
             LEFT JOIN auth a ON d.user_id = a.tg_id
             ${whereClause} 
             ORDER BY d.created_at DESC LIMIT ? OFFSET ?`,
            [...params, String(limit), String(offset)]
        );

        return res.json({ deposits, total: Number(total) });
    } catch (err) {
        console.error('[admin/deposits]', err);
        return res.status(500).json({ error: 'Failed to load deposits' });
    }
});

// ─── Resolve / Status Update Deposit ──────────────────────────────
router.post('/deposits/status', async (req, res) => {
    const conn = await pool.getConnection();
    try {
        const { deposit_id, status, update_balance = false } = req.body;
        if (!deposit_id || !status) {
            conn.release();
            return res.status(400).json({ error: 'deposit_id and status are required' });
        }

        const validStatuses = ['completed', 'success', 'pending', 'failed', 'expired', 'cancelled'];
        if (!validStatuses.includes(status)) {
            conn.release();
            return res.status(400).json({ error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` });
        }

        await conn.beginTransaction();

        const [rows] = await conn.execute('SELECT * FROM deposits WHERE id = ? FOR UPDATE', [deposit_id]);
        const deposit = rows[0];

        if (!deposit) {
            await conn.rollback();
            conn.release();
            return res.status(404).json({ error: 'Deposit not found' });
        }

        const oldStatus = deposit.status;
        const depositAmount = parseFloat(deposit.amount) || 0;
        const userId = String(deposit.user_id);
        const isNewSuccess = status === 'completed' || status === 'success';
        const isOldSuccess = oldStatus === 'completed' || oldStatus === 'success';

        if (isNewSuccess && !deposit.completed_at) {
            await conn.execute(
                'UPDATE deposits SET status = ?, completed_at = NOW() WHERE id = ?',
                [status, deposit_id]
            );
        } else {
            await conn.execute(
                'UPDATE deposits SET status = ? WHERE id = ?',
                [status, deposit_id]
            );
        }

        let newBalance = null;

        if (update_balance) {
            if (isNewSuccess && !isOldSuccess) {
                await conn.execute(
                    'UPDATE auth SET balance = balance + ?, last_deposit = NOW() WHERE tg_id = ?',
                    [depositAmount, userId]
                );
                const [[u]] = await conn.execute('SELECT balance FROM auth WHERE tg_id = ?', [userId]);
                newBalance = parseFloat(u?.balance || 0);

                await conn.execute(
                    `INSERT INTO transactions (user_id, type, amount, balance_after, reference_type, reference_id, description, created_at)
                     VALUES (?, 'deposit', ?, ?, 'deposit', ?, ?, NOW())`,
                    [userId, depositAmount, newBalance, deposit_id, `Admin approved deposit #${deposit_id} (${status})`]
                );

                await conn.execute(
                    `INSERT INTO alerts (user_id, title, message, type)
                     VALUES (?, 'Deposit Confirmed', ?, 'success')`,
                    [userId, `Your deposit of ${depositAmount.toFixed(2)} ETB has been manually confirmed and credited to your balance!`]
                );
            } else if (!isNewSuccess && isOldSuccess) {
                await conn.execute(
                    'UPDATE auth SET balance = GREATEST(0, balance - ?) WHERE tg_id = ?',
                    [depositAmount, userId]
                );
                const [[u]] = await conn.execute('SELECT balance FROM auth WHERE tg_id = ?', [userId]);
                newBalance = parseFloat(u?.balance || 0);

                await conn.execute(
                    `INSERT INTO transactions (user_id, type, amount, balance_after, reference_type, reference_id, description, created_at)
                     VALUES (?, 'refund', ?, ?, 'deposit', ?, ?, NOW())`,
                    [userId, -depositAmount, newBalance, deposit_id, `Admin changed deposit #${deposit_id} status from ${oldStatus} to ${status}`]
                );
            }
        }

        await conn.commit();
        conn.release();

        if (update_balance && isNewSuccess && !isOldSuccess) {
            try {
                notifyDeposit({
                    uid: userId,
                    amount: depositAmount.toString(),
                    uuid: 'AdminManual'
                });
            } catch (notifyErr) {
                console.error('[admin/deposits/status] notifyDeposit error:', notifyErr);
            }
        }

        return res.json({
            success: true,
            old_status: oldStatus,
            new_status: status,
            new_balance: newBalance,
            message: `Deposit #${deposit_id} status updated to '${status}'`
        });
    } catch (err) {
        try { await conn.rollback(); } catch {}
        conn.release();
        console.error('[admin/deposits/status]', err);
        return res.status(500).json({ error: 'Failed to update deposit status: ' + err.message });
    }
});

router.post('/deposits/resolve', async (req, res) => {
    const { deposit_id, action } = req.body;

    if (!deposit_id || !['completed', 'failed'].includes(action)) {
        return res.status(400).json({ error: 'Missing deposit_id or valid action (completed | failed)' });
    }

    const conn = await pool.getConnection();

    try {
        await conn.beginTransaction();

        const [deposits] = await conn.execute(
            'SELECT * FROM deposits WHERE id = ? FOR UPDATE',
            [deposit_id]
        );
        const deposit = deposits[0];

        if (!deposit) {
            await conn.rollback();
            conn.release();
            return res.status(404).json({ error: 'Deposit not found' });
        }

        if (deposit.status === 'success' || deposit.status === 'completed') {
            await conn.rollback();
            conn.release();
            return res.status(400).json({ error: 'Deposit is already marked as completed' });
        }

        if (deposit.status === 'failed' && action === 'failed') {
            await conn.rollback();
            conn.release();
            return res.status(400).json({ error: 'Deposit is already marked as failed' });
        }

        if (action === 'completed') {
            const amount = parseFloat(deposit.amount) || 0;
            const userId = String(deposit.user_id);

            await conn.execute(
                "UPDATE deposits SET status = 'completed', completed_at = NOW() WHERE id = ?",
                [deposit.id]
            );

            await conn.execute(
                'UPDATE auth SET balance = balance + ?, last_deposit = NOW() WHERE tg_id = ?',
                [amount, userId]
            );

            const [balRows] = await conn.execute(
                'SELECT balance FROM auth WHERE tg_id = ?',
                [userId]
            );
            const newBalance = parseFloat(balRows[0]?.balance) || 0;

            await conn.execute(
                `INSERT INTO transactions (user_id, type, amount, balance_after, reference_type, reference_id, description, created_at)
                 VALUES (?, 'deposit', ?, ?, 'admin_manual', ?, 'Manual admin deposit confirmation', NOW())`,
                [userId, amount, newBalance, deposit.id]
            );

            await conn.execute(
                `INSERT INTO alerts (user_id, title, message, type)
                 VALUES (?, 'Deposit Confirmed', ?, 'success')`,
                [userId, `Your deposit of ${amount.toFixed(2)} ETB has been manually confirmed and credited to your balance!`]
            );

            await conn.commit();
            conn.release();

            try {
                notifyDeposit({
                    uid: userId,
                    amount: amount.toString(),
                    uuid: 'AdminManual'
                });
            } catch (notifyErr) {
                console.error('[deposits/resolve] notifyDeposit error:', notifyErr);
            }

            return res.json({
                success: true,
                status: 'completed',
                new_balance: newBalance,
                message: `Deposit #${deposit.id} marked as completed and ${amount.toFixed(2)} ETB credited.`
            });
        } else if (action === 'failed') {
            await conn.execute(
                "UPDATE deposits SET status = 'failed' WHERE id = ?",
                [deposit.id]
            );

            await conn.commit();
            conn.release();

            return res.json({
                success: true,
                status: 'failed',
                message: `Deposit #${deposit.id} marked as failed.`
            });
        }
    } catch (err) {
        try { await conn.rollback(); } catch {}
        conn.release();
        console.error('[admin/deposits/resolve]', err);
        return res.status(500).json({ error: 'Failed to resolve deposit: ' + err.message });
    }
});

// Helper to fetch minimum multiplicity set by main admin (joadmin)
async function getJoadminMinMultiplier() {
    try {
        const joadminUrl = getCleanJoadminUrl();
        const res = await fetch(`${joadminUrl}/api/admin/reseller/min-multiplier`);
        if (res.ok) {
            const data = await res.json();
            if (data && (data.joadmin_multiplier || data.min_rate_multiplier || data.rate_multiplier)) {
                return parseFloat(data.joadmin_multiplier || data.min_rate_multiplier || data.rate_multiplier) || 55;
            }
        }
    } catch (e) {
        console.error('[getJoadminMinMultiplier] Failed to fetch from joadmin:', e.message);
    }
    return 55;
}

// ─── Settings ───────────────────────────────────────────────────
router.get('/settings', async (req, res) => {
    try {
        const [rows] = await pool.execute('SELECT setting_key, setting_value FROM settings');
        const settings = {};
        rows.forEach(r => { settings[r.setting_key] = r.setting_value; });

        const minAllowed = await getJoadminMinMultiplier();

        return res.json({
            rate_multiplier: settings.rate_multiplier || '55',
            min_rate_multiplier: String(minAllowed),
            discount_percent: settings.discount_percent || '0',
            holiday_name: settings.holiday_name || '',
            maintenance_mode: settings.maintenance_mode || '0',
            user_can_order: settings.user_can_order || '1',
            marquee_text: settings.marquee_text || '',
            top_services_ids: settings.top_services_ids || '',
            reseller_balance: settings.reseller_balance || '0.00',
            total_deposit: settings.total_deposit || '0.00',
            sms_ethiopia_api_key: settings.sms_ethiopia_api_key || process.env.SMS_ETHIOPIA_API_KEY || 'PEQBNQ8X1P6MBJH76701ZUGIX5DP7UOZ:1098',
        });
    } catch (err) {
        console.error('[admin/settings]', err);
        return res.status(500).json({ error: 'Failed to load settings' });
    }
});

router.post('/settings', async (req, res) => {
    try {
        const { key, value } = req.body;
        if (!key) return res.status(400).json({ error: 'key is required' });

        await pool.execute(
            'INSERT INTO settings (setting_key, setting_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE setting_value = ?',
            [key, value, value]
        );

        return res.json({ success: true });
    } catch (err) {
        console.error('[admin/settings]', err);
        return res.status(500).json({ error: 'Failed to update setting' });
    }
});

// ─── Reseller Balance & Operations ──────────────────────────────────
router.get('/reseller/status', async (req, res) => {
    try {
        const [rows] = await pool.execute('SELECT setting_key, setting_value FROM settings');
        const settings = {};
        rows.forEach(r => { settings[r.setting_key] = r.setting_value; });

        const minAllowed = await getJoadminMinMultiplier();

        return res.json({
            success: true,
            reseller_balance: parseFloat(settings.reseller_balance || '0'),
            total_deposit: parseFloat(settings.total_deposit || '0'),
            min_rate_multiplier: minAllowed,
            rate_multiplier: parseFloat(settings.rate_multiplier || '55')
        });
    } catch (err) {
        console.error('[admin/reseller/status]', err);
        return res.status(500).json({ error: 'Failed to fetch reseller status' });
    }
});

router.post('/reseller/add-balance', async (req, res) => {
    try {
        const amount = parseFloat(req.body.amount);
        if (isNaN(amount) || amount <= 0) {
            return res.status(400).json({ error: 'Invalid deposit amount' });
        }

        const [rows] = await pool.execute(
            'SELECT setting_value FROM settings WHERE setting_key = "reseller_balance"'
        );
        const currentBal = rows.length > 0 ? parseFloat(rows[0].setting_value || '0') : 0;
        const newBal = (currentBal + amount).toFixed(2);

        await pool.execute(
            'INSERT INTO settings (setting_key, setting_value) VALUES ("reseller_balance", ?) ON DUPLICATE KEY UPDATE setting_value = ?',
            [newBal, newBal]
        );

        return res.json({ success: true, new_balance: parseFloat(newBal) });
    } catch (err) {
        console.error('[admin/reseller/add-balance]', err);
        return res.status(500).json({ error: 'Failed to add balance' });
    }
});

router.post('/reseller/withdraw-deposit', async (req, res) => {
    try {
        const amount = parseFloat(req.body.amount);
        const { bank_name, account_number, account_name } = req.body;

        if (isNaN(amount) || amount <= 0) {
            return res.status(400).json({ error: 'Invalid withdrawal amount' });
        }
        if (!bank_name || !account_number) {
            return res.status(400).json({ error: 'Bank name and account number are required' });
        }

        const [rows] = await pool.execute(
            'SELECT setting_value FROM settings WHERE setting_key = "total_deposit"'
        );
        const currentTotal = rows.length > 0 ? parseFloat(rows[0].setting_value || '0') : 0;

        if (amount > currentTotal) {
            return res.status(400).json({
                error: `Withdrawal amount (${amount} ETB) exceeds available Total Deposit balance (${currentTotal.toFixed(2)} ETB)`
            });
        }

        const newTotal = (currentTotal - amount).toFixed(2);
        await pool.execute(
            'INSERT INTO settings (setting_key, setting_value) VALUES ("total_deposit", ?) ON DUPLICATE KEY UPDATE setting_value = ?',
            [newTotal, newTotal]
        );

        const [insertResult] = await pool.execute(
            'INSERT INTO admin_withdrawals (amount, bank_name, account_number, account_name, status, created_at) VALUES (?, ?, ?, ?, "pending", NOW())',
            [amount, bank_name, account_number, account_name || '']
        );
        const localId = insertResult.insertId;

        let smsResult = null;
        try {
            const resellerName = account_name || 'Reseller';
            smsResult = await sendWithdrawalSmsAlert(resellerName, amount);
        } catch (smsErr) {
            console.error('[reseller/withdraw-deposit] SMS trigger error:', smsErr.message);
            smsResult = { success: false, error: smsErr.message };
        }

        let joadminRequestId = null;
        try {
            const apiKey = getJoadminApiKey();
            const joadminRes = await fetch(`${JOADMIN_SERVER_URL}/api/admin/reseller/withdrawal-request`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': apiKey,
                },
                body: JSON.stringify({
                    reseller_id: RESELLER_ID,
                    local_id: localId,
                    amount,
                    bank_name,
                    account_number,
                    account_name: account_name || '',
                    callback_url: `${PRIMORA_SERVER_URL}/api/admin/reseller/withdrawal/confirm`,
                }),
            });
            if (joadminRes.ok) {
                const joadminData = await joadminRes.json();
                joadminRequestId = joadminData.request_id || null;
                if (joadminRequestId) {
                    await pool.execute(
                        'UPDATE admin_withdrawals SET joadmin_request_id = ? WHERE id = ?',
                        [joadminRequestId, localId]
                    );
                }
            }
        } catch (e) {
            console.error('[reseller/withdraw-deposit] Failed to notify joadmin:', e.message);
        }

        // Dispatch Telegram Notification via Paxadmin Bot (8662579997:AAHp2xw6pZLOcfHumSWfmT3BsU8NMsfMA0Y) to Paxyo Admin Telegram Accounts
        try {
            const withdrawBotToken = process.env.WITHDRAWAL_BOT_TOKEN || '8662579997:AAHp2xw6pZLOcfHumSWfmT3BsU8NMsfMA0Y';
            const adminChatIds = [5928771903, 779060335, 460529558];
            const msgText = `💸 <b>New Reseller Withdrawal Request</b>\n\n` +
                            `👤 Reseller: <b>${account_name || 'Primora Admin'}</b>\n` +
                            `💵 Amount: <b>${amount.toFixed(2)} ETB</b>\n` +
                            `🏦 Bank: <b>${bank_name}</b>\n` +
                            `🔢 Account Number: <code>${account_number}</code>\n` +
                            `🆔 Local Request ID: <code>#${localId}</code>\n` +
                            `🕒 Time: ${new Date().toLocaleString()}`;

            for (const chatId of adminChatIds) {
                try {
                    await fetch(`https://api.telegram.org/bot${withdrawBotToken}/sendMessage`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            chat_id: chatId,
                            text: msgText,
                            parse_mode: 'HTML'
                        })
                    });
                } catch (bErr) {}
            }
        } catch (botErr) {
            console.error('[reseller/withdraw-deposit] Bot alert error:', botErr.message);
        }

        return res.json({
            success: true,
            new_total_deposit: parseFloat(newTotal),
            local_id: localId,
            joadmin_request_id: joadminRequestId,
            status: 'pending',
            message: 'Withdrawal request submitted. Awaiting joadmin confirmation.'
        });
    } catch (err) {
        console.error('[admin/reseller/withdraw-deposit]', err);
        return res.status(500).json({ error: 'Failed to process withdrawal: ' + err.message });
    }
});

// ─── GET /reseller/withdrawal-history ────────────────────────────────
router.get('/reseller/withdrawal-history', async (req, res) => {
    try {
        const [rows] = await pool.execute(
            'SELECT * FROM admin_withdrawals ORDER BY created_at DESC LIMIT 100'
        );
        return res.json({ success: true, withdrawals: rows });
    } catch (err) {
        console.error('[admin/reseller/withdrawal-history]', err);
        return res.status(500).json({ success: false, error: 'Failed to load withdrawal history' });
    }
});

// ─── Custom Services & Activity ────────────────────────────────────
router.get('/services/custom', async (req, res) => {
    try {
        const [rows] = await pool.execute('SELECT * FROM service_custom ORDER BY id DESC');
        return res.json(rows);
    } catch (err) {
        console.error('[admin/services/custom]', err);
        return res.status(500).json({ error: 'Failed to load custom pricing', details: err.message });
    }
});

router.post('/services/custom', async (req, res) => {
    try {
        const { service_id, custom_rate, profit_margin, is_enabled, custom_description } = req.body;
        if (!service_id) return res.status(400).json({ error: 'service_id is required' });

        const desc = custom_description !== undefined ? custom_description : null;

        await pool.execute(
            `INSERT INTO service_custom (service_id, custom_rate, profit_margin, is_enabled, custom_description) 
             VALUES (?, ?, ?, ?, ?) 
             ON DUPLICATE KEY UPDATE 
             custom_rate = COALESCE(?, custom_rate),
             profit_margin = COALESCE(?, profit_margin),
             is_enabled = COALESCE(?, is_enabled),
             custom_description = ?`,
            [service_id, custom_rate, profit_margin, is_enabled, desc, custom_rate, profit_margin, is_enabled, desc]
        );

        return res.json({ success: true });
    } catch (err) {
        console.error('[admin/services/custom]', err);
        return res.status(500).json({ error: 'Failed to update custom pricing', details: err.message });
    }
});

router.delete('/services/custom/:serviceId', async (req, res) => {
    try {
        const { serviceId } = req.params;
        await pool.execute('DELETE FROM service_custom WHERE service_id = ?', [serviceId]);
        return res.json({ success: true });
    } catch (err) {
        console.error('[admin/services/custom]', err);
        return res.status(500).json({ error: 'Failed to delete custom pricing', details: err.message });
    }
});

router.get('/services/activity', async (req, res) => {
    try {
        try {
            const [rows] = await pool.execute(
                `SELECT sc.*, a.username, a.first_name 
                 FROM service_custom sc 
                 LEFT JOIN auth a ON sc.updated_by = a.tg_id
                 ORDER BY sc.id DESC LIMIT 20`
            );
            return res.json(rows);
        } catch (joinErr) {
            const [rows] = await pool.execute(
                'SELECT * FROM service_custom ORDER BY id DESC LIMIT 20'
            );
            return res.json(rows);
        }
    } catch (err) {
        console.error('[admin/services/activity]', err);
        return res.status(500).json({ error: 'Failed to load activity', details: err.message });
    }
});

router.get('/services/disabled', async (req, res) => {
    try {
        const [rows] = await pool.execute(
            'SELECT * FROM service_custom WHERE is_enabled = FALSE OR is_enabled = 0 ORDER BY id DESC'
        );
        return res.json(rows);
    } catch (err) {
        console.error('[admin/services/disabled]', err);
        return res.status(500).json({ error: 'Failed to load disabled services', details: err.message });
    }
});

// ─── Support Chat ────────────────────────────────────────────────
router.get('/chat/sessions', async (req, res) => {
    let conn;
    try {
        conn = await pool.getConnection();
        const [sessions] = await conn.execute(`
            SELECT c.user_id, a.username, a.first_name, MAX(c.created_at) as last_message_at
            FROM chat_messages c
            LEFT JOIN auth a ON c.user_id = a.tg_id
            GROUP BY c.user_id, a.username, a.first_name
            ORDER BY last_message_at DESC
        `);
        return res.json(sessions);
    } catch (err) {
        console.error('[admin/chat/sessions] Error:', err.message);
        return res.status(500).json({ error: err.message });
    } finally {
        if (conn) conn.release();
    }
});

router.get('/chat/:user_id', async (req, res) => {
    try {
        const { user_id } = req.params;
        const [messages] = await pool.execute(
            'SELECT * FROM chat_messages WHERE user_id = ? ORDER BY created_at ASC',
            [user_id]
        );
        return res.json(messages);
    } catch (err) {
        console.error('[admin/chat/messages]', err);
        return res.status(500).json({ error: 'Failed to load messages' });
    }
});

router.post('/chat/:user_id', async (req, res) => {
    try {
        const { user_id } = req.params;
        const { message } = req.body;
        if (!message) return res.status(400).json({ error: 'message is required' });

        await pool.execute(
            'INSERT INTO chat_messages (user_id, message, is_admin, created_at) VALUES (?, ?, 1, NOW())',
            [user_id, message]
        );

        await pool.execute(
            'INSERT INTO alerts (user_id, title, message, type) VALUES (?, ?, ?, ?)',
            [user_id, 'New Message', 'You have a new message from support', 'chat']
        );

        return res.json({ success: true });
    } catch (err) {
        console.error('[admin/chat/send]', err);
        return res.status(500).json({ error: 'Failed to send message' });
    }
});

// ─── Withdrawals ─────────────────────────────────────────────────
router.get('/withdrawals', async (req, res) => {
    try {
        const [rows] = await pool.execute(`
            SELECT w.*, a.username, a.first_name, a.last_name 
            FROM withdrawals w 
            LEFT JOIN auth a ON w.user_id = a.tg_id
            ORDER BY w.created_at DESC
        `);
        return res.json({ success: true, withdrawals: rows });
    } catch (err) {
        console.error('[admin/withdrawals]', err);
        return res.status(500).json({ error: 'Failed to load withdrawals' });
    }
});

router.post('/withdrawals/approve', async (req, res) => {
    try {
        const { id } = req.body;
        if (!id) {
            return res.status(400).json({ error: 'Missing withdrawal ID' });
        }

        const conn = await pool.getConnection();
        try {
            await conn.beginTransaction();

            const [withdrawals] = await conn.execute('SELECT * FROM withdrawals WHERE id = ? FOR UPDATE', [id]);
            const w = withdrawals[0];

            if (!w) {
                await conn.rollback();
                conn.release();
                return res.status(404).json({ error: 'Withdrawal request not found' });
            }

            if (w.status === 'done') {
                await conn.rollback();
                conn.release();
                return res.status(400).json({ error: 'Withdrawal is already completed' });
            }

            await conn.execute("UPDATE withdrawals SET status = 'done' WHERE id = ?", [id]);

            await conn.execute(
                "INSERT INTO alerts (user_id, title, message, type) VALUES (?, ?, ?, 'success')",
                [w.user_id, 'Withdrawal Done', `Your withdrawal request of ${parseFloat(w.amount).toFixed(2)} ETB has been marked as DONE and transferred to your bank account!`]
            );

            await conn.commit();
            conn.release();

            return res.json({ success: true });
        } catch (err) {
            await conn.rollback();
            conn.release();
            throw err;
        }
    } catch (err) {
        console.error('[admin/withdrawals/approve]', err);
        return res.status(500).json({ error: 'Failed to approve withdrawal' });
    }
});

// ─── ROUTE: /admin/finance-stats (GET) ───────────────────────────
router.get('/finance-stats', async (req, res) => {
    try {
        const [[{ totalRevenue }]] = await pool.execute("SELECT COALESCE(SUM(amount), 0) as totalRevenue FROM deposits WHERE status IN ('completed', 'success')");
        const [[{ todayRevenue }]] = await pool.execute("SELECT COALESCE(SUM(amount), 0) as todayRevenue FROM deposits WHERE status IN ('completed', 'success') AND created_at >= CURDATE()");
        const [[{ weeklyRevenue }]] = await pool.execute("SELECT COALESCE(SUM(amount), 0) as weeklyRevenue FROM deposits WHERE status IN ('completed', 'success') AND created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)");
        const [[{ monthlyRevenue }]] = await pool.execute("SELECT COALESCE(SUM(amount), 0) as monthlyRevenue FROM deposits WHERE status IN ('completed', 'success') AND created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)");

        const [[{ prevWeeklyRevenue }]] = await pool.execute(
            "SELECT COALESCE(SUM(amount), 0) as prevWeeklyRevenue FROM deposits WHERE status IN ('completed', 'success') AND created_at >= DATE_SUB(NOW(), INTERVAL 14 DAY) AND created_at < DATE_SUB(NOW(), INTERVAL 7 DAY)"
        );

        const [[{ totalWithdrawn }]] = await pool.execute("SELECT COALESCE(SUM(amount), 0) as totalWithdrawn FROM withdrawals WHERE status = 'done'");
        const [[{ todayWithdrawals }]] = await pool.execute("SELECT COALESCE(SUM(amount), 0) as todayWithdrawals FROM withdrawals WHERE status = 'done' AND created_at >= CURDATE()");
        const [[{ weeklyWithdrawals }]] = await pool.execute("SELECT COALESCE(SUM(amount), 0) as weeklyWithdrawals FROM withdrawals WHERE status = 'done' AND created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)");
        const [[{ monthlyWithdrawals }]] = await pool.execute("SELECT COALESCE(SUM(amount), 0) as monthlyWithdrawals FROM withdrawals WHERE status = 'done' AND created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)");
        const [[{ pendingWithdrawals }]] = await pool.execute("SELECT COALESCE(SUM(amount), 0) as pendingWithdrawals FROM withdrawals WHERE status = 'pending'");
        const [[{ totalWithdrawalsCount }]] = await pool.execute("SELECT COUNT(*) as totalWithdrawalsCount FROM withdrawals");
        const [[{ totalWithdrawalsSum }]] = await pool.execute("SELECT COALESCE(SUM(amount), 0) as totalWithdrawalsSum FROM withdrawals");

        const [[{ withdrawableBalance }]] = await pool.execute("SELECT COALESCE(SUM(balance), 0) as withdrawableBalance FROM auth");

        const [[{ totalPayingUsers }]] = await pool.execute("SELECT COUNT(DISTINCT user_id) as totalPayingUsers FROM deposits WHERE status IN ('completed', 'success')");

        const [orders] = await pool.execute(`
            SELECT o.*, sc.profit_margin, sc.custom_rate 
            FROM orders o 
            LEFT JOIN service_custom sc ON o.service_id = sc.service_id
        `);

        let providerCosts = 0;
        orders.forEach(o => {
            const costVal = o.cost !== undefined && o.cost !== null ? o.cost : o.charge;
            const cost = costVal ? parseFloat(costVal) : 0;
            if (cost <= 0) return;

            const margin = o.profit_margin ? parseFloat(o.profit_margin) : 0;
            const customRate = o.custom_rate ? parseFloat(o.custom_rate) : null;

            if (margin > 0) {
                providerCosts += cost / (1 + margin / 100);
            } else if (customRate !== null && customRate > 0) {
                providerCosts += cost * 0.80;
            } else {
                providerCosts += cost / 1.15;
            }
        });

        const thisWeek = parseFloat(weeklyRevenue);
        const prevWeek = parseFloat(prevWeeklyRevenue);
        let revenueGrowth = 0;
        if (prevWeek > 0) {
            revenueGrowth = ((thisWeek - prevWeek) / prevWeek) * 100;
        } else if (thisWeek > 0) {
            revenueGrowth = 100;
        }

        return res.json({
            success: true,
            totalRevenue: parseFloat(totalRevenue),
            todayRevenue: parseFloat(todayRevenue),
            weeklyRevenue: parseFloat(weeklyRevenue),
            monthlyRevenue: parseFloat(monthlyRevenue),
            totalWithdrawn: parseFloat(totalWithdrawn),
            todayWithdrawals: parseFloat(todayWithdrawals),
            weeklyWithdrawals: parseFloat(weeklyWithdrawals),
            monthlyWithdrawals: parseFloat(monthlyWithdrawals),
            withdrawableBalance: parseFloat(withdrawableBalance),
            pendingWithdrawals: parseFloat(pendingWithdrawals),
            totalWithdrawals: parseFloat(totalWithdrawalsSum),
            totalWithdrawalsCount: parseInt(totalWithdrawalsCount),
            totalPayingUsers: parseInt(totalPayingUsers),
            providerCosts: parseFloat(providerCosts.toFixed(2)),
            revenueGrowth: parseFloat(revenueGrowth.toFixed(1))
        });
    } catch (err) {
        console.error('[admin/finance-stats]', err);
        return res.status(500).json({ error: 'Failed to load finance stats' });
    }
});

// Helper to send Telegram message
async function sendTelegram(tgId, message, imageUrl) {
    const token = process.env.CLIENT_BOT_TOKEN || '8590320768:AAHwFYYxr5h0_mJdwQ9In14qvL3pquzTEUs';
    if (!token) {
        throw new Error('CLIENT_BOT_TOKEN is not configured');
    }

    const defaultAppUrl = process.env.MINI_APP_URL || 'https://primora-client.onrender.com';
    const replyMarkup = {
        inline_keyboard: [
            [
                {
                    text: 'Open App 🎵',
                    web_app: {
                        url: defaultAppUrl
                    }
                }
            ]
        ]
    };

    let url;
    let body;
    if (imageUrl) {
        url = `https://api.telegram.org/bot${token}/sendPhoto`;
        body = {
            chat_id: String(tgId),
            photo: imageUrl,
            parse_mode: 'HTML',
            reply_markup: replyMarkup
        };
        if (message) {
            body.caption = message;
        }
    } else {
        url = `https://api.telegram.org/bot${token}/sendMessage`;
        body = {
            chat_id: String(tgId),
            text: message || '',
            parse_mode: 'HTML',
            reply_markup: replyMarkup
        };
    }

    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
    });

    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Telegram API Error: ${response.status} - ${errText}`);
    }

    const resJson = await response.json();
    if (!resJson.ok) {
        throw new Error(`Telegram API Error: ${resJson.description || 'Unknown error'}`);
    }

    return resJson;
}

// ─── Send Telegram Route ──────────────────────────────────────────
router.post('/send-telegram', async (req, res) => {
    try {
        const { target, message, imageUrl } = req.body;

        if (!message && !imageUrl) {
            return res.status(400).json({ error: 'Either message or imageUrl is required' });
        }

        if (!target) {
            return res.status(400).json({ error: 'Target is required' });
        }

        if (target === 'all') {
            const [users] = await pool.execute('SELECT tg_id, first_name, username FROM auth WHERE tg_id IS NOT NULL');

            const results = [];

            for (const user of users) {
                const personalizedText = message || '';
                const firstName = user.first_name || 'User';
                const username = user.username ? `@${user.username}` : '';
                const displayName = `${firstName} ${username}`.trim() || `User ${user.tg_id}`;

                const finalMsg = personalizedText
                    .replace(/{name}/gi, firstName)
                    .replace(/{first_name}/gi, firstName);

                try {
                    await sendTelegram(user.tg_id, finalMsg, imageUrl);
                    results.push({
                        tg_id: user.tg_id,
                        name: displayName,
                        status: 'success'
                    });
                } catch (err) {
                    console.error(`Failed to send Telegram message to ${user.tg_id}:`, err.message);
                    results.push({
                        tg_id: user.tg_id,
                        name: displayName,
                        status: 'failed',
                        error: err.message
                    });
                }
            }

            return res.json({ success: true, results });
        } else {
            let personalizedText = message || '';
            try {
                const [rows] = await pool.execute('SELECT first_name FROM auth WHERE tg_id = ? LIMIT 1', [target]);
                if (rows.length > 0) {
                    const firstName = rows[0].first_name || 'User';
                    personalizedText = personalizedText
                        .replace(/{name}/gi, firstName)
                        .replace(/{first_name}/gi, firstName);
                }
            } catch (dbErr) {
                console.error('Failed to fetch user for personalization:', dbErr.message);
            }

            const tgRes = await sendTelegram(target, personalizedText, imageUrl);
            const defaultAppUrl = process.env.MINI_APP_URL || 'https://primora-client.onrender.com';

            const [result] = await pool.execute(
                "INSERT INTO broadcasts (message, image_url, btn_text, btn_url, created_at) VALUES (?, ?, 'Open App 🎵', ?, NOW())",
                [message || '', imageUrl || null, defaultAppUrl]
            );
            const broadcastId = result.insertId;

            if (tgRes && tgRes.ok && tgRes.result && tgRes.result.message_id) {
                await pool.execute(
                    'INSERT INTO broadcast_messages (broadcast_id, tg_id, telegram_message_id, status, error_message, created_at) VALUES (?, ?, ?, ?, ?, NOW())',
                    [broadcastId, target, tgRes.result.message_id, 'sent', null]
                );
            }

            return res.json({ success: true });
        }
    } catch (err) {
        console.error('[admin/send-telegram]', err);
        return res.status(500).json({ error: err.message || 'Failed to send Telegram message' });
    }
});

// Helper to send broadcast Telegram message
async function sendBroadcastMessage(tgId, message, imageUrl, btnText = 'Open App 🎵', btnUrl = null) {
    const token = process.env.CLIENT_BOT_TOKEN || '8590320768:AAHwFYYxr5h0_mJdwQ9In14qvL3pquzTEUs';
    if (!token) {
        throw new Error('CLIENT_BOT_TOKEN is not configured');
    }

    const defaultAppUrl = btnUrl || process.env.MINI_APP_URL || 'https://primora-client.onrender.com';
    const replyMarkup = {
        inline_keyboard: [
            [
                {
                    text: btnText || 'Open App 🎵',
                    web_app: {
                        url: defaultAppUrl
                    }
                }
            ]
        ]
    };

    let url;
    let body;
    if (imageUrl) {
        url = `https://api.telegram.org/bot${token}/sendPhoto`;
        body = {
            chat_id: String(tgId),
            photo: imageUrl,
            parse_mode: 'HTML',
            reply_markup: replyMarkup
        };
        if (message) {
            body.caption = message;
        }
    } else {
        url = `https://api.telegram.org/bot${token}/sendMessage`;
        body = {
            chat_id: String(tgId),
            text: message || '',
            parse_mode: 'HTML',
            reply_markup: replyMarkup
        };
    }

    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
    });

    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Telegram API Error: ${response.status} - ${errText}`);
    }

    const resJson = await response.json();
    if (!resJson.ok) {
        throw new Error(`Telegram API Error: ${resJson.description || 'Unknown error'}`);
    }

    return resJson;
}

// Helper to edit Telegram message
async function editTelegramMessage(tgId, messageId, newMessage, imageUrl, btnText = 'Open App 🎵', btnUrl = null) {
    const token = process.env.CLIENT_BOT_TOKEN || '8590320768:AAHwFYYxr5h0_mJdwQ9In14qvL3pquzTEUs';
    if (!token) {
        throw new Error('CLIENT_BOT_TOKEN is not configured');
    }

    const defaultAppUrl = btnUrl || process.env.MINI_APP_URL || 'https://primora-client.onrender.com';
    const replyMarkup = {
        inline_keyboard: [
            [
                {
                    text: btnText || 'Open App 🎵',
                    web_app: {
                        url: defaultAppUrl
                    }
                }
            ]
        ]
    };

    let url;
    let body;
    if (imageUrl) {
        url = `https://api.telegram.org/bot${token}/editMessageCaption`;
        body = {
            chat_id: String(tgId),
            message_id: Number(messageId),
            caption: newMessage,
            parse_mode: 'HTML',
            reply_markup: replyMarkup
        };
    } else {
        url = `https://api.telegram.org/bot${token}/editMessageText`;
        body = {
            chat_id: String(tgId),
            message_id: Number(messageId),
            text: newMessage,
            parse_mode: 'HTML',
            reply_markup: replyMarkup
        };
    }

    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
    });

    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Telegram API Error: ${response.status} - ${errText}`);
    }

    const resJson = await response.json();
    if (!resJson.ok) {
        throw new Error(`Telegram API Error: ${resJson.description || 'Unknown error'}`);
    }

    return resJson;
}

// Helper to delete Telegram message
async function deleteTelegramMessage(tgId, messageId) {
    const token = process.env.CLIENT_BOT_TOKEN || '8590320768:AAHwFYYxr5h0_mJdwQ9In14qvL3pquzTEUs';
    if (!token) {
        throw new Error('CLIENT_BOT_TOKEN is not configured');
    }

    const url = `https://api.telegram.org/bot${token}/deleteMessage`;
    const body = {
        chat_id: String(tgId),
        message_id: Number(messageId)
    };

    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
    });

    return await response.json();
}

// Route to get broadcasts list
router.get('/broadcasts', async (req, res) => {
    try {
        const [rows] = await pool.execute(`
            SELECT b.*, 
                   (SELECT COUNT(*) FROM broadcast_messages bm WHERE bm.broadcast_id = b.id AND bm.status = 'sent') as sent_count,
                   (SELECT COUNT(*) FROM broadcast_messages bm WHERE bm.broadcast_id = b.id AND bm.status = 'failed') as failed_count
            FROM broadcasts b
            ORDER BY b.created_at DESC
        `);
        return res.json(rows);
    } catch (err) {
        console.error('[admin/broadcasts GET]', err);
        return res.status(500).json({ error: 'Failed to load broadcasts' });
    }
});

// Route to create a broadcast
router.post('/broadcasts', async (req, res) => {
    try {
        const { message, imageUrl, btnText, btnUrl } = req.body;
        if (!message && !imageUrl) {
            return res.status(400).json({ error: 'Either message or imageUrl is required' });
        }

        const bText = btnText || 'Open App 🎵';
        const bUrl = btnUrl || 'https://primora-client.onrender.com';

        const [result] = await pool.execute(
            'INSERT INTO broadcasts (message, image_url, btn_text, btn_url, created_at) VALUES (?, ?, ?, ?, NOW())',
            [message || '', imageUrl || null, bText, bUrl]
        );
        const broadcastId = result.insertId;

        const [users] = await pool.execute('SELECT tg_id, first_name FROM auth WHERE tg_id IS NOT NULL');

        let sentCount = 0;
        let failedCount = 0;

        for (const user of users) {
            let personalizedText = message || '';
            const firstName = user.first_name || 'User';
            personalizedText = personalizedText
                .replace(/{name}/gi, firstName)
                .replace(/{first_name}/gi, firstName);

            try {
                const tgRes = await sendBroadcastMessage(user.tg_id, personalizedText, imageUrl, bText, bUrl);
                if (tgRes && tgRes.ok && tgRes.result && tgRes.result.message_id) {
                    const msgId = tgRes.result.message_id;
                    await pool.execute(
                        'INSERT INTO broadcast_messages (broadcast_id, tg_id, telegram_message_id, status, error_message, created_at) VALUES (?, ?, ?, ?, ?, NOW())',
                        [broadcastId, user.tg_id, msgId, 'sent', null]
                    );
                    sentCount++;
                } else {
                    await pool.execute(
                        'INSERT INTO broadcast_messages (broadcast_id, tg_id, telegram_message_id, status, error_message, created_at) VALUES (?, ?, ?, ?, ?, NOW())',
                        [broadcastId, user.tg_id, 0, 'failed', 'Invalid Telegram response']
                    );
                    failedCount++;
                }
            } catch (err) {
                await pool.execute(
                    'INSERT INTO broadcast_messages (broadcast_id, tg_id, telegram_message_id, status, error_message, created_at) VALUES (?, ?, ?, ?, ?, NOW())',
                    [broadcastId, user.tg_id, 0, 'failed', err.message]
                );
                failedCount++;
            }
        }

        return res.json({
            success: true,
            broadcast_id: broadcastId,
            sent_count: sentCount,
            failed_count: failedCount
        });
    } catch (err) {
        console.error('[admin/broadcasts POST]', err);
        return res.status(500).json({ error: 'Failed to create broadcast' });
    }
});

// Route to edit a broadcast
router.put('/broadcasts/:id', async (req, res) => {
    try {
        const broadcastId = req.params.id;
        const { message, imageUrl, btnText, btnUrl } = req.body;

        const bText = btnText || 'Open App 🎵';
        const bUrl = btnUrl || 'https://primora-client.onrender.com';

        await pool.execute(
            'UPDATE broadcasts SET message = ?, image_url = ?, btn_text = ?, btn_url = ? WHERE id = ?',
            [message || '', imageUrl || null, bText, bUrl, broadcastId]
        );

        const [messages] = await pool.execute(
            "SELECT tg_id, telegram_message_id, custom_message FROM broadcast_messages WHERE broadcast_id = ? AND status = 'sent'",
            [broadcastId]
        );

        let updatedCount = 0;
        let failedCount = 0;

        for (const msg of messages) {
            try {
                const [uRows] = await pool.execute('SELECT first_name FROM auth WHERE tg_id = ? LIMIT 1', [msg.tg_id]);
                const firstName = uRows.length > 0 ? (uRows[0].first_name || 'User') : 'User';

                const textToEdit = msg.custom_message || message || '';

                const personalizedText = textToEdit
                    .replace(/{name}/gi, firstName)
                    .replace(/{first_name}/gi, firstName);

                await editTelegramMessage(msg.tg_id, msg.telegram_message_id, personalizedText, imageUrl, bText, bUrl);
                updatedCount++;
            } catch (err) {
                failedCount++;
            }
        }

        return res.json({
            success: true,
            updated_count: updatedCount,
            failed_count: failedCount
        });
    } catch (err) {
        console.error('[admin/broadcasts PUT]', err);
        return res.status(500).json({ error: 'Failed to update broadcast' });
    }
});

// Route to delete a broadcast
router.delete('/broadcasts/:id', async (req, res) => {
    try {
        const broadcastId = req.params.id;

        const [messages] = await pool.execute(
            "SELECT tg_id, telegram_message_id FROM broadcast_messages WHERE broadcast_id = ? AND status = 'sent'",
            [broadcastId]
        );

        let deletedCount = 0;
        let failedCount = 0;

        for (const msg of messages) {
            try {
                await deleteTelegramMessage(msg.tg_id, msg.telegram_message_id);
                deletedCount++;
            } catch (err) {
                failedCount++;
            }
        }

        await pool.execute('DELETE FROM broadcasts WHERE id = ?', [broadcastId]);

        return res.json({
            success: true,
            deleted_count: deletedCount,
            failed_count: failedCount
        });
    } catch (err) {
        console.error('[admin/broadcasts DELETE]', err);
        return res.status(500).json({ error: 'Failed to delete broadcast' });
    }
});

// Route to list messages sent for a specific broadcast
router.get('/broadcasts/:id/messages', async (req, res) => {
    try {
        const broadcastId = req.params.id;
        const [rows] = await pool.execute(`
            SELECT bm.*, a.first_name, a.username 
            FROM broadcast_messages bm
            LEFT JOIN auth a ON bm.tg_id = a.tg_id
            WHERE bm.broadcast_id = ?
            ORDER BY bm.created_at ASC
        `, [broadcastId]);
        return res.json(rows);
    } catch (err) {
        console.error('[admin/broadcasts/:id/messages GET]', err);
        return res.status(500).json({ error: 'Failed to load broadcast messages' });
    }
});

// Route to update a specific sent message
router.put('/broadcasts/messages/:msg_id', async (req, res) => {
    try {
        const msgId = req.params.msg_id;
        const { message, imageUrl } = req.body;

        const [records] = await pool.execute(`
            SELECT bm.*, b.btn_text, b.btn_url 
            FROM broadcast_messages bm
            JOIN broadcasts b ON bm.broadcast_id = b.id
            WHERE bm.id = ? AND bm.status = 'sent'
        `, [msgId]);
        const msgRecord = records[0];

        if (!msgRecord) {
            return res.status(404).json({ error: 'Sent message record not found or already failed' });
        }

        await editTelegramMessage(
            msgRecord.tg_id,
            msgRecord.telegram_message_id,
            message,
            imageUrl,
            msgRecord.btn_text,
            msgRecord.btn_url
        );

        await pool.execute('UPDATE broadcast_messages SET custom_message = ? WHERE id = ?', [message, msgId]);

        return res.json({ success: true });
    } catch (err) {
        console.error('[admin/broadcasts/messages/:msg_id PUT]', err);
        return res.status(500).json({ error: 'Failed to update user message' });
    }
});

// Route to delete a specific sent message
router.delete('/broadcasts/messages/:msg_id', async (req, res) => {
    try {
        const msgId = req.params.msg_id;

        const [records] = await pool.execute(
            "SELECT tg_id, telegram_message_id FROM broadcast_messages WHERE id = ? AND status = 'sent'",
            [msgId]
        );
        const msgRecord = records[0];

        if (msgRecord) {
            await deleteTelegramMessage(msgRecord.tg_id, msgRecord.telegram_message_id);
        }

        await pool.execute('DELETE FROM broadcast_messages WHERE id = ?', [msgId]);

        return res.json({ success: true });
    } catch (err) {
        console.error('[admin/broadcasts/messages/:msg_id DELETE]', err);
        return res.status(500).json({ error: 'Failed to delete user message' });
    }
});

// Helper to sync active holiday in holidays table with settings table
async function syncActiveHolidayToSettings() {
    try {
        const [activeRows] = await pool.execute(
            "SELECT name, discount_percent FROM holidays WHERE status = 'active' ORDER BY id DESC LIMIT 1"
        );
        if (activeRows.length > 0) {
            const hName = activeRows[0].name || '';
            const hDisc = String(activeRows[0].discount_percent || 0);
            await pool.execute(
                "INSERT INTO settings (setting_key, setting_value) VALUES ('holiday_name', ?) ON DUPLICATE KEY UPDATE setting_value = ?",
                [hName, hName]
            );
            await pool.execute(
                "INSERT INTO settings (setting_key, setting_value) VALUES ('discount_percent', ?) ON DUPLICATE KEY UPDATE setting_value = ?",
                [hDisc, hDisc]
            );
        } else {
            await pool.execute(
                "INSERT INTO settings (setting_key, setting_value) VALUES ('holiday_name', '') ON DUPLICATE KEY UPDATE setting_value = ''"
            );
            await pool.execute(
                "INSERT INTO settings (setting_key, setting_value) VALUES ('discount_percent', '0') ON DUPLICATE KEY UPDATE setting_value = '0'"
            );
        }
    } catch (err) {
        console.error('[syncActiveHolidayToSettings] Error:', err.message);
    }
}

// ─── Holidays Routes ──────────────────────────────────────────────
router.get('/holidays', async (req, res) => {
    try {
        const [rows] = await pool.execute(
            'SELECT * FROM holidays ORDER BY start_date ASC, id DESC'
        );
        return res.json({ success: true, holidays: rows });
    } catch (err) {
        console.error('[admin/holidays GET]', err);
        return res.status(500).json({ error: 'Failed to load holidays' });
    }
});

router.post('/holidays', async (req, res) => {
    try {
        const { id, name, discount_percent, status, start_date, end_date, category, is_recurring, description } = req.body;
        if (!name) {
            return res.status(400).json({ error: 'Holiday name is required' });
        }

        const disc = parseInt(discount_percent || 0, 10);
        const stat = status === 'active' ? 'active' : 'inactive';
        const cat = category || 'custom';
        const recur = is_recurring === false || is_recurring === 0 ? 0 : 1;
        const desc = description || '';

        let targetId = id;
        if (id) {
            await pool.execute(
                `UPDATE holidays 
                 SET name = ?, discount_percent = ?, status = ?, start_date = ?, end_date = ?, category = ?, is_recurring = ?, description = ?
                 WHERE id = ?`,
                [name, disc, stat, start_date || null, end_date || null, cat, recur, desc, id]
            );
        } else {
            const [insRes] = await pool.execute(
                `INSERT INTO holidays (name, discount_percent, status, start_date, end_date, category, is_recurring, description) 
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [name, disc, stat, start_date || null, end_date || null, cat, recur, desc]
            );
            targetId = insRes.insertId;
        }

        if (stat === 'active' && targetId) {
            await pool.execute('UPDATE holidays SET status = "inactive" WHERE id != ?', [targetId]);
        }

        await syncActiveHolidayToSettings();

        return res.json({ success: true });
    } catch (err) {
        console.error('[admin/holidays POST]', err);
        return res.status(500).json({ error: 'Failed to save holiday' });
    }
});

router.delete('/holidays/:id', async (req, res) => {
    try {
        const { id } = req.params;
        await pool.execute('DELETE FROM holidays WHERE id = ?', [id]);
        await syncActiveHolidayToSettings();
        return res.json({ success: true });
    } catch (err) {
        console.error('[admin/holidays DELETE]', err);
        return res.status(500).json({ error: 'Failed to delete holiday' });
    }
});

router.post('/holidays/:id/toggle', async (req, res) => {
    try {
        const { id } = req.params;
        const [rows] = await pool.execute('SELECT * FROM holidays WHERE id = ?', [id]);
        if (!rows[0]) {
            return res.status(404).json({ error: 'Holiday not found' });
        }

        const newStatus = rows[0].status === 'active' ? 'inactive' : 'active';
        if (newStatus === 'active') {
            await pool.execute('UPDATE holidays SET status = "inactive" WHERE id != ?', [id]);
        }
        await pool.execute('UPDATE holidays SET status = ? WHERE id = ?', [newStatus, id]);

        await syncActiveHolidayToSettings();

        return res.json({ success: true, status: newStatus });
    } catch (err) {
        console.error('[admin/holidays toggle]', err);
        return res.status(500).json({ error: 'Failed to toggle holiday' });
    }
});

router.post('/holidays/seed-presets', async (req, res) => {
    try {
        const presets = [
            { name: 'Enkutatash (Ethiopian New Year)', discount_percent: 15, category: 'ethiopian', start_date: '2026-09-11', end_date: '2026-09-12', description: 'Celebrate the Ethiopian New Year with 15% off across all services!' },
            { name: 'Meskel', discount_percent: 10, category: 'ethiopian', start_date: '2026-09-27', end_date: '2026-09-28', description: 'Finding of the True Cross celebration discount.' },
            { name: 'Genna (Ethiopian Christmas)', discount_percent: 20, category: 'ethiopian', start_date: '2027-01-07', end_date: '2027-01-08', description: 'Merry Christmas! Enjoy 20% off all orders.' },
            { name: 'Timkat (Epiphany)', discount_percent: 15, category: 'ethiopian', start_date: '2027-01-19', end_date: '2027-01-20', description: 'Epiphany special celebration discount.' },
            { name: 'Adwa Victory Day', discount_percent: 10, category: 'ethiopian', start_date: '2027-03-02', end_date: '2027-03-02', description: 'Celebrating Victory of Adwa with 10% discount.' },
            { name: 'Siklet (Good Friday)', discount_percent: 10, category: 'ethiopian', start_date: '2027-04-30', end_date: '2027-04-30', description: 'Good Friday special rate reduction.' },
            { name: 'Fasika (Ethiopian Easter)', discount_percent: 25, category: 'ethiopian', start_date: '2027-05-02', end_date: '2027-05-03', description: 'Happy Easter! Huge 25% discount on all SMM boost packages.' },
            { name: 'Patriots Victory Day', discount_percent: 10, category: 'ethiopian', start_date: '2027-05-05', end_date: '2027-05-05', description: 'Patriots Victory Day special rate.' },
            { name: 'Eid al-Fitr', discount_percent: 15, category: 'international', start_date: '2027-03-10', end_date: '2027-03-11', description: 'Eid Mubarak! Special 15% discount.' },
            { name: 'Eid al-Adha', discount_percent: 15, category: 'international', start_date: '2027-05-16', end_date: '2027-05-17', description: 'Eid Mubarak! Special holiday reduction.' },
            { name: 'Mawlid', discount_percent: 10, category: 'international', start_date: '2026-09-15', end_date: '2026-09-16', description: 'Prophet Birthday celebration discount.' },
            { name: 'Launch Super Sale 🚀', discount_percent: 20, category: 'custom', start_date: null, end_date: null, description: 'Primora Launch special promotion.' },
            { name: 'Weekend Flash Boost ⚡', discount_percent: 10, category: 'custom', start_date: null, end_date: null, description: 'Flash weekend boost discount.' }
        ];

        let addedCount = 0;
        for (const item of presets) {
            const [existing] = await pool.execute('SELECT id FROM holidays WHERE name = ?', [item.name]);
            if (existing.length === 0) {
                await pool.execute(
                    `INSERT INTO holidays (name, discount_percent, status, start_date, end_date, category, is_recurring, description) 
                     VALUES (?, ?, 'inactive', ?, ?, ?, 1, ?)`,
                    [item.name, item.discount_percent, item.start_date, item.end_date, item.category, item.description]
                );
                addedCount++;
            }
        }

        return res.json({ success: true, added: addedCount, message: `Added ${addedCount} new holiday presets.` });
    } catch (err) {
        console.error('[admin/holidays seed-presets]', err);
        return res.status(500).json({ error: 'Failed to seed holiday presets' });
    }
});

export default router;
