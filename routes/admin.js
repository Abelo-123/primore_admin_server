/**
 * Admin Routes — Paxyo Admin Panel Backend (Scoped by bot_id)
 *
 * Provides JWT-like token auth and CRUD endpoints for:
 * - Dashboard statistics
 * - User management (list, balance, role)
 * - Order history (all users)
 * - Deposit history (all users)
 * - Settings management
 */
import { Router } from 'express';
import pool from '../config/database.js';

const router = Router();

// Resolve the bot_id (defaulting to the one in the environment BOT_TOKEN)
const botToken = process.env.BOT_TOKEN || '';
const adminBotId = botToken ? botToken.split(':')[0] : '8731737556';
const JOADMIN_SERVER_URL = process.env.JOADMIN_SERVER_URL || 'https://padmin121.onrender.com';
const JOADMIN_API_KEY = process.env.JOADMIN_API_KEY || process.env.GODOFPANEL_API_KEY || '';
const RESELLER_ID = process.env.RESELLER_ID || 'primore';
const PRIMORA_SERVER_URL = process.env.SITE_URL || 'https://primore-admin-server.onrender.com';

// Helper to get effective admin password (DB override > env)
async function getEffectiveAdminPassword() {
    try {
        const [rows] = await pool.execute(
            "SELECT setting_value FROM settings WHERE setting_key = 'admin_password' AND bot_id = ? LIMIT 1",
            [adminBotId]
        );
        if (rows.length > 0 && rows[0].setting_value) {
            return rows[0].setting_value;
        }
    } catch (e) {
        console.error('[getEffectiveAdminPassword] DB error:', e.message);
    }
    return process.env.ADMIN_PASSWORD || 'paxyo2026';
}

// Middleware to check admin password auth
router.use(async (req, res, next) => {
    // Public paths — no auth needed
    if (req.path === '/login' || req.path === '/reseller/withdrawal/confirm' || req.path === '/reseller/public-status') {
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
                // Format: username:password:botToken:botId
                providedPass = parts[1];
            } else if (parts.length === 2) {
                // Format: username:password
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
        const [[{ totalUsers }]] = await pool.execute('SELECT COUNT(*) as totalUsers FROM auth WHERE bot_id = ?', [adminBotId]);
        const [[{ totalOrders }]] = await pool.execute('SELECT COUNT(*) as totalOrders FROM orders WHERE bot_id = ?', [adminBotId]);
        const [[{ totalDeposits }]] = await pool.execute("SELECT COUNT(*) as totalDeposits FROM deposits WHERE status IN ('completed', 'success') AND bot_id = ?", [adminBotId]);
        const [[{ totalRevenue }]] = await pool.execute("SELECT COALESCE(SUM(amount), 0) as totalRevenue FROM deposits WHERE status IN ('completed', 'success') AND bot_id = ?", [adminBotId]);

        const [recentOrders] = await pool.execute(`
            SELECT o.*, a.username, a.first_name 
            FROM orders o 
            LEFT JOIN auth a ON o.user_id = a.tg_id AND a.bot_id = o.bot_id
            WHERE o.bot_id = ?
            ORDER BY o.created_at DESC LIMIT 10
        `, [adminBotId]);

        const [recentDeposits] = await pool.execute(`
            SELECT d.*, a.username, a.first_name 
            FROM deposits d 
            LEFT JOIN auth a ON d.user_id = a.tg_id AND a.bot_id = d.bot_id
            WHERE d.bot_id = ?
            ORDER BY d.created_at DESC LIMIT 10
        `, [adminBotId]);

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

        let whereClause = 'WHERE bot_id = ?';
        let params = [adminBotId];

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

        await pool.execute('UPDATE auth SET balance = balance + ? WHERE tg_id = ? AND bot_id = ?', [amount, tg_id, adminBotId]);
        const [[user]] = await pool.execute('SELECT balance FROM auth WHERE tg_id = ? AND bot_id = ?', [tg_id, adminBotId]);

        if (!user) {
            return res.status(404).json({ error: 'User not found for this bot' });
        }

        // Log the transaction
        const txType = amount >= 0 ? 'bonus' : 'refund';
        await pool.execute(
            `INSERT INTO transactions (user_id, type, amount, balance_after, reference_type, description, bot_id, created_at)
             VALUES (?, ?, ?, ?, 'admin', 'Admin balance adjustment', ?, NOW())`,
            [tg_id, txType, amount, user.balance, adminBotId]
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

        await pool.execute('UPDATE auth SET role = ? WHERE tg_id = ? AND bot_id = ?', [role, tg_id, adminBotId]);
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
            // Broadcast to every user of this bot
            await pool.execute(
                `INSERT INTO alerts (user_id, title, message, type, bot_id)
                 SELECT tg_id, ?, ?, ?, ? FROM auth WHERE bot_id = ?`,
                [title, message, type, adminBotId, adminBotId]
            );
        } else {
            // Send to a specific user by tg_id for this bot
            await pool.execute(
                'INSERT INTO alerts (user_id, title, message, type, bot_id) VALUES (?, ?, ?, ?, ?)',
                [target, title, message, type, adminBotId]
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

        let whereClause = 'WHERE o.bot_id = ?';
        let params = [adminBotId];

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
            `SELECT COUNT(*) as total FROM orders o LEFT JOIN auth a ON o.user_id = a.tg_id AND a.bot_id = o.bot_id ${whereClause}`, params
        );

        const [orders] = await pool.execute(
            `SELECT o.*, a.username, a.first_name 
             FROM orders o 
             LEFT JOIN auth a ON o.user_id = a.tg_id AND a.bot_id = o.bot_id
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

        let whereClause = 'WHERE d.bot_id = ?';
        let params = [adminBotId];

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
            `SELECT COUNT(*) as total FROM deposits d LEFT JOIN auth a ON d.user_id = a.tg_id AND a.bot_id = d.bot_id ${whereClause}`, params
        );

        const [deposits] = await pool.execute(
            `SELECT d.*, a.username, a.first_name 
             FROM deposits d 
             LEFT JOIN auth a ON d.user_id = a.tg_id AND a.bot_id = d.bot_id
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

// Helper to fetch minimum multiplicity set by main admin (joadmin)
async function getJoadminMinMultiplier() {
    try {
        const joadminUrl = process.env.JOADMIN_SERVER_URL || 'https://padmin121.onrender.com';
        const res = await fetch(`${joadminUrl}/api/admin/reseller/min-multiplier`);
        if (res.ok) {
            const data = await res.json();
            if (data && data.min_rate_multiplier) {
                return parseFloat(data.min_rate_multiplier) || 55;
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
        const [rows] = await pool.execute('SELECT setting_key, setting_value FROM settings WHERE bot_id = ?', [adminBotId]);
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

        if (key === 'rate_multiplier') {
            const minAllowed = await getJoadminMinMultiplier();
            if (parseFloat(value) < minAllowed) {
                return res.status(400).json({
                    error: `Rate multiplier (${value}) cannot be lower than the minimum multiplicity baseline (${minAllowed}) set by main admin (joadmin).`
                });
            }
        }

        // Upsert for adminBotId and update all matching key rows so client endpoints read updated value regardless of bot_id
        await pool.execute(
            'INSERT INTO settings (setting_key, bot_id, setting_value) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE setting_value = ?',
            [key, adminBotId, value, value]
        );
        await pool.execute(
            'UPDATE settings SET setting_value = ? WHERE setting_key = ?',
            [value, key]
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
        const [rows] = await pool.execute('SELECT setting_key, setting_value FROM settings WHERE bot_id = ?', [adminBotId]);
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
            'SELECT setting_value FROM settings WHERE setting_key = "reseller_balance" AND bot_id = ?',
            [adminBotId]
        );
        const currentBal = rows.length > 0 ? parseFloat(rows[0].setting_value || '0') : 0;
        const newBal = (currentBal + amount).toFixed(2);

        await pool.execute(
            'INSERT INTO settings (setting_key, bot_id, setting_value) VALUES ("reseller_balance", ?, ?) ON DUPLICATE KEY UPDATE setting_value = ?',
            [adminBotId, newBal, newBal]
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

        // Check total_deposit balance
        const [rows] = await pool.execute(
            'SELECT setting_value FROM settings WHERE setting_key = "total_deposit" AND bot_id = ?',
            [adminBotId]
        );
        const currentTotal = rows.length > 0 ? parseFloat(rows[0].setting_value || '0') : 0;

        if (amount > currentTotal) {
            return res.status(400).json({
                error: `Withdrawal amount (${amount} ETB) exceeds available Total Deposit balance (${currentTotal.toFixed(2)} ETB)`
            });
        }

        // Deduct from total_deposit immediately (reserve it)
        const newTotal = (currentTotal - amount).toFixed(2);
        await pool.execute(
            'INSERT INTO settings (setting_key, bot_id, setting_value) VALUES ("total_deposit", ?, ?) ON DUPLICATE KEY UPDATE setting_value = ?',
            [adminBotId, newTotal, newTotal]
        );

        // Ensure admin_withdrawals has status + joadmin_request_id columns
        try {
            await pool.execute("ALTER TABLE admin_withdrawals ADD COLUMN status VARCHAR(50) DEFAULT 'pending'");
        } catch (e) {}
        try {
            await pool.execute('ALTER TABLE admin_withdrawals ADD COLUMN joadmin_request_id INT DEFAULT NULL');
        } catch (e) {}

        // Save withdrawal request locally as 'pending'
        const [insertResult] = await pool.execute(
            'INSERT INTO admin_withdrawals (amount, bank_name, account_number, account_name, status, created_at) VALUES (?, ?, ?, ?, "pending", NOW())',
            [amount, bank_name, account_number, account_name || '']
        );
        const localId = insertResult.insertId;

        // Forward request to joadmin (best effort)
        let joadminRequestId = null;
        try {
            const joadminRes = await fetch(`${JOADMIN_SERVER_URL}/api/admin/reseller/withdrawal-request`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': JOADMIN_API_KEY,
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

// ─── GET /reseller/withdrawal-history — List primora admin withdrawals ──
router.get('/reseller/withdrawal-history', async (req, res) => {
    try {
        const [rows] = await pool.execute(
            'SELECT * FROM admin_withdrawals ORDER BY created_at DESC LIMIT 50'
        );
        return res.json({ success: true, withdrawals: rows });
    } catch (err) {
        console.error('[admin/reseller/withdrawal-history]', err);
        return res.status(500).json({ error: 'Failed to load withdrawal history' });
    }
});

// ─── POST /reseller/withdrawal/confirm — Called BY joadmin when money sent ─
// No admin auth — protected by API key from joadmin
router.post('/reseller/withdrawal/confirm', async (req, res) => {
    try {
        const providedKey = req.headers['x-api-key'] || req.body?.api_key || '';
        if (!JOADMIN_API_KEY || providedKey !== JOADMIN_API_KEY) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const { local_id, joadmin_request_id } = req.body;
        if (!local_id && !joadmin_request_id) {
            return res.status(400).json({ error: 'local_id or joadmin_request_id required' });
        }

        let whereClause = 'id = ?';
        let whereParam = local_id;
        if (!local_id && joadmin_request_id) {
            whereClause = 'joadmin_request_id = ?';
            whereParam = joadmin_request_id;
        }

        const [rows] = await pool.execute(
            `SELECT * FROM admin_withdrawals WHERE ${whereClause} LIMIT 1`,
            [whereParam]
        );
        const withdrawal = rows[0];
        if (!withdrawal) {
            return res.status(404).json({ error: 'Withdrawal request not found' });
        }
        if (withdrawal.status === 'sent') {
            return res.json({ success: true, message: 'Already confirmed' });
        }

        await pool.execute(
            "UPDATE admin_withdrawals SET status = 'sent' WHERE id = ?",
            [withdrawal.id]
        );

        console.log(`[reseller/withdrawal/confirm] Withdrawal #${withdrawal.id} (${withdrawal.amount} ETB) marked as sent by joadmin`);
        return res.json({ success: true, message: 'Withdrawal marked as sent' });
    } catch (err) {
        console.error('[admin/reseller/withdrawal/confirm]', err);
        return res.status(500).json({ error: 'System error' });
    }
});

// ─── Service Custom Pricing ────────────────────────────────────────
router.get('/services/custom', async (req, res) => {
    try {
        const [rows] = await pool.execute('SELECT * FROM service_custom WHERE bot_id = ? ORDER BY updated_at DESC', [adminBotId]);
        return res.json(rows);
    } catch (err) {
        console.error('[admin/services/custom]', err);
        return res.status(500).json({ error: 'Failed to load custom pricing' });
    }
});

router.post('/services/custom', async (req, res) => {
    try {
        console.log('[services/custom POST] Received req.body:', JSON.stringify(req.body));
        const { service_id, custom_rate, profit_margin, is_enabled, custom_description } = req.body;
        if (!service_id) return res.status(400).json({ error: 'service_id is required' });

        const desc = custom_description !== undefined ? custom_description : null;

        await pool.execute(
            `INSERT INTO service_custom (service_id, bot_id, custom_rate, profit_margin, is_enabled, custom_description) 
             VALUES (?, ?, ?, ?, ?, ?) 
             ON DUPLICATE KEY UPDATE 
             custom_rate = COALESCE(?, custom_rate),
             profit_margin = COALESCE(?, profit_margin),
             is_enabled = COALESCE(?, is_enabled),
             custom_description = ?`,
            [service_id, adminBotId, custom_rate, profit_margin, is_enabled, desc, custom_rate, profit_margin, is_enabled, desc]
        );

        return res.json({ success: true });
    } catch (err) {
        console.error('[admin/services/custom]', err);
        return res.status(500).json({ error: 'Failed to update custom pricing' });
    }
});

router.delete('/services/custom/:serviceId', async (req, res) => {
    try {
        const { serviceId } = req.params;
        await pool.execute('DELETE FROM service_custom WHERE service_id = ? AND bot_id = ?', [serviceId, adminBotId]);
        return res.json({ success: true });
    } catch (err) {
        console.error('[admin/services/custom]', err);
        return res.status(500).json({ error: 'Failed to delete custom pricing' });
    }
});

// ─── Service Activity Log ───────────────────────────────────────────
router.get('/services/activity', async (req, res) => {
    try {
        const [rows] = await pool.execute(
            `SELECT sc.*, a.username, a.first_name 
             FROM service_custom sc 
             LEFT JOIN auth a ON sc.updated_by = a.tg_id AND a.bot_id = sc.bot_id
             WHERE sc.bot_id = ?
             ORDER BY sc.updated_at DESC LIMIT 20`,
            [adminBotId]
        );
        return res.json(rows);
    } catch (err) {
        console.error('[admin/services/activity]', err);
        return res.status(500).json({ error: 'Failed to load activity' });
    }
});

// ─── Disabled Services ────────────────────────────────────────────────
router.get('/services/disabled', async (req, res) => {
    try {
        const [rows] = await pool.execute(
            'SELECT * FROM service_custom WHERE is_enabled = FALSE AND bot_id = ? ORDER BY updated_at DESC',
            [adminBotId]
        );
        return res.json(rows);
    } catch (err) {
        console.error('[admin/services/disabled]', err);
        return res.status(500).json({ error: 'Failed to load disabled services' });
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
            LEFT JOIN auth a ON c.user_id = a.tg_id AND a.bot_id = c.bot_id
            WHERE c.bot_id = ?
            GROUP BY c.user_id, a.username, a.first_name
            ORDER BY last_message_at DESC
        `, [adminBotId]);
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
            'SELECT * FROM chat_messages WHERE user_id = ? AND bot_id = ? ORDER BY created_at ASC',
            [user_id, adminBotId]
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
            'INSERT INTO chat_messages (user_id, bot_id, message, is_admin, created_at) VALUES (?, ?, ?, 1, NOW())',
            [user_id, adminBotId, message]
        );

        await pool.execute(
            'INSERT INTO alerts (user_id, title, message, type, bot_id) VALUES (?, ?, ?, ?, ?)',
            [user_id, 'New Message', 'You have a new message from support', 'chat', adminBotId]
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
            LEFT JOIN auth a ON w.user_id = a.tg_id AND a.bot_id = w.bot_id
            WHERE w.bot_id = ?
            ORDER BY w.created_at DESC
        `, [adminBotId]);
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

            const [withdrawals] = await conn.execute('SELECT * FROM withdrawals WHERE id = ? AND bot_id = ? FOR UPDATE', [id, adminBotId]);
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

            // Update status to done
            await conn.execute('UPDATE withdrawals SET status = \'done\' WHERE id = ? AND bot_id = ?', [id, adminBotId]);

            // Notify user
            await conn.execute(
                'INSERT INTO alerts (user_id, title, message, type, bot_id) VALUES (?, ?, ?, \'success\', ?)',
                [w.user_id, 'Withdrawal Done', `Your withdrawal request of ${parseFloat(w.amount).toFixed(2)} ETB has been marked as DONE and transferred to your bank account!`, adminBotId]
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
        // 1. Revenues (completed deposits)
        const [[{ totalRevenue }]] = await pool.execute("SELECT COALESCE(SUM(amount), 0) as totalRevenue FROM deposits WHERE status IN ('completed', 'success') AND bot_id = ?", [adminBotId]);
        const [[{ todayRevenue }]] = await pool.execute("SELECT COALESCE(SUM(amount), 0) as todayRevenue FROM deposits WHERE status IN ('completed', 'success') AND created_at >= CURDATE() AND bot_id = ?", [adminBotId]);
        const [[{ weeklyRevenue }]] = await pool.execute("SELECT COALESCE(SUM(amount), 0) as weeklyRevenue FROM deposits WHERE status IN ('completed', 'success') AND created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY) AND bot_id = ?", [adminBotId]);
        const [[{ monthlyRevenue }]] = await pool.execute("SELECT COALESCE(SUM(amount), 0) as monthlyRevenue FROM deposits WHERE status IN ('completed', 'success') AND created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY) AND bot_id = ?", [adminBotId]);

        // Previous week's revenue (for growth %)
        const [[{ prevWeeklyRevenue }]] = await pool.execute(
            "SELECT COALESCE(SUM(amount), 0) as prevWeeklyRevenue FROM deposits WHERE status IN ('completed', 'success') AND created_at >= DATE_SUB(NOW(), INTERVAL 14 DAY) AND created_at < DATE_SUB(NOW(), INTERVAL 7 DAY) AND bot_id = ?",
            [adminBotId]
        );

        // 2. Withdrawals
        const [[{ totalWithdrawn }]] = await pool.execute("SELECT COALESCE(SUM(amount), 0) as totalWithdrawn FROM withdrawals WHERE status = 'done' AND bot_id = ?", [adminBotId]);
        const [[{ todayWithdrawals }]] = await pool.execute("SELECT COALESCE(SUM(amount), 0) as todayWithdrawals FROM withdrawals WHERE status = 'done' AND created_at >= CURDATE() AND bot_id = ?", [adminBotId]);
        const [[{ weeklyWithdrawals }]] = await pool.execute("SELECT COALESCE(SUM(amount), 0) as weeklyWithdrawals FROM withdrawals WHERE status = 'done' AND created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY) AND bot_id = ?", [adminBotId]);
        const [[{ monthlyWithdrawals }]] = await pool.execute("SELECT COALESCE(SUM(amount), 0) as monthlyWithdrawals FROM withdrawals WHERE status = 'done' AND created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY) AND bot_id = ?", [adminBotId]);
        const [[{ pendingWithdrawals }]] = await pool.execute("SELECT COALESCE(SUM(amount), 0) as pendingWithdrawals FROM withdrawals WHERE status = 'pending' AND bot_id = ?", [adminBotId]);
        const [[{ totalWithdrawalsCount }]] = await pool.execute("SELECT COUNT(*) as totalWithdrawalsCount FROM withdrawals WHERE bot_id = ?", [adminBotId]);
        const [[{ totalWithdrawalsSum }]] = await pool.execute("SELECT COALESCE(SUM(amount), 0) as totalWithdrawalsSum FROM withdrawals WHERE bot_id = ?", [adminBotId]);

        // 3. Wallet / Withdrawable Balance
        const [[{ withdrawableBalance }]] = await pool.execute("SELECT COALESCE(SUM(balance), 0) as withdrawableBalance FROM auth WHERE bot_id = ?", [adminBotId]);

        // 4. Paying Users
        const [[{ totalPayingUsers }]] = await pool.execute("SELECT COUNT(DISTINCT user_id) as totalPayingUsers FROM deposits WHERE status IN ('completed', 'success') AND bot_id = ?", [adminBotId]);

        // 5. Provider Costs (estimate based on profit margin / custom rates)
        const [orders] = await pool.execute(`
            SELECT o.*, sc.profit_margin, sc.custom_rate 
            FROM orders o 
            LEFT JOIN service_custom sc ON o.service_id = sc.service_id AND sc.bot_id = o.bot_id
            WHERE o.bot_id = ?
        `, [adminBotId]);

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
                providerCosts += cost * 0.80; // default 20% margin for custom rates
            } else {
                providerCosts += cost / 1.15; // default 15% markup
            }
        });

        // 6. Growth calculation
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
    const token = process.env.CLIENT_BOT_TOKEN;
    if (!token) {
        throw new Error('CLIENT_BOT_TOKEN is not configured');
    }
    
    const replyMarkup = {
        inline_keyboard: [
            [
                {
                    text: 'Open App 🎵',
                    web_app: {
                        url: 'https://musical-caramel-cae47e.netlify.app/'
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
            // Broadcast to all users of this bot
            const [users] = await pool.execute('SELECT tg_id, first_name, username FROM auth WHERE tg_id IS NOT NULL AND bot_id = ?', [adminBotId]);
            
            const results = [];
            
            // Loop through users and send message
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
            // Send to a single user
            // Get user's first name for personalization if target is a tg_id
            let personalizedText = message || '';
            try {
                const [rows] = await pool.execute('SELECT first_name FROM auth WHERE tg_id = ? AND bot_id = ? LIMIT 1', [target, adminBotId]);
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

            const [result] = await pool.execute(
                "INSERT INTO broadcasts (message, image_url, btn_text, btn_url, bot_id, created_at) VALUES (?, ?, 'Open App 🎵', 'https://musical-caramel-cae47e.netlify.app/', ?, NOW())",
                [message || '', imageUrl || null, adminBotId]
            );
            const broadcastId = result.insertId;

            if (tgRes && tgRes.ok && tgRes.result && tgRes.result.message_id) {
                await pool.execute(
                    'INSERT INTO broadcast_messages (broadcast_id, tg_id, telegram_message_id, status, error_message, bot_id, created_at) VALUES (?, ?, ?, ?, ?, ?, NOW())',
                    [broadcastId, target, tgRes.result.message_id, 'sent', null, adminBotId]
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
async function sendBroadcastMessage(tgId, message, imageUrl, btnText = 'Open App 🎵', btnUrl = 'https://musical-caramel-cae47e.netlify.app/') {
    const token = process.env.CLIENT_BOT_TOKEN;
    if (!token) {
        throw new Error('CLIENT_BOT_TOKEN is not configured');
    }
    
    const replyMarkup = {
        inline_keyboard: [
            [
                {
                    text: btnText || 'Open App 🎵',
                    web_app: {
                        url: btnUrl || 'https://musical-caramel-cae47e.netlify.app/'
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
async function editTelegramMessage(tgId, messageId, newMessage, imageUrl, btnText = 'Open App 🎵', btnUrl = 'https://musical-caramel-cae47e.netlify.app/') {
    const token = process.env.CLIENT_BOT_TOKEN;
    if (!token) {
        throw new Error('CLIENT_BOT_TOKEN is not configured');
    }

    const replyMarkup = {
        inline_keyboard: [
            [
                {
                    text: btnText || 'Open App 🎵',
                    web_app: {
                        url: btnUrl || 'https://musical-caramel-cae47e.netlify.app/'
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
    const token = process.env.CLIENT_BOT_TOKEN;
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
                   (SELECT COUNT(*) FROM broadcast_messages bm WHERE bm.broadcast_id = b.id AND bm.status = 'sent' AND bm.bot_id = b.bot_id) as sent_count,
                   (SELECT COUNT(*) FROM broadcast_messages bm WHERE bm.broadcast_id = b.id AND bm.status = 'failed' AND bm.bot_id = b.bot_id) as failed_count
            FROM broadcasts b
            WHERE b.bot_id = ?
            ORDER BY b.created_at DESC
        `, [adminBotId]);
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
        const bUrl = btnUrl || 'https://musical-caramel-cae47e.netlify.app/';

        const [result] = await pool.execute(
            'INSERT INTO broadcasts (message, image_url, btn_text, btn_url, bot_id, created_at) VALUES (?, ?, ?, ?, ?, NOW())',
            [message || '', imageUrl || null, bText, bUrl, adminBotId]
        );
        const broadcastId = result.insertId;

        const [users] = await pool.execute('SELECT tg_id, first_name FROM auth WHERE tg_id IS NOT NULL AND bot_id = ?', [adminBotId]);

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
                        'INSERT INTO broadcast_messages (broadcast_id, tg_id, telegram_message_id, status, error_message, bot_id, created_at) VALUES (?, ?, ?, ?, ?, ?, NOW())',
                        [broadcastId, user.tg_id, msgId, 'sent', null, adminBotId]
                    );
                    sentCount++;
                } else {
                    await pool.execute(
                        'INSERT INTO broadcast_messages (broadcast_id, tg_id, telegram_message_id, status, error_message, bot_id, created_at) VALUES (?, ?, ?, ?, ?, ?, NOW())',
                        [broadcastId, user.tg_id, 0, 'failed', 'Invalid Telegram response', adminBotId]
                    );
                    failedCount++;
                }
            } catch (err) {
                await pool.execute(
                    'INSERT INTO broadcast_messages (broadcast_id, tg_id, telegram_message_id, status, error_message, bot_id, created_at) VALUES (?, ?, ?, ?, ?, ?, NOW())',
                    [broadcastId, user.tg_id, 0, 'failed', err.message, adminBotId]
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
        const bUrl = btnUrl || 'https://musical-caramel-cae47e.netlify.app/';

        await pool.execute(
            'UPDATE broadcasts SET message = ?, image_url = ?, btn_text = ?, btn_url = ? WHERE id = ? AND bot_id = ?',
            [message || '', imageUrl || null, bText, bUrl, broadcastId, adminBotId]
        );

        const [messages] = await pool.execute(
            "SELECT tg_id, telegram_message_id, custom_message FROM broadcast_messages WHERE broadcast_id = ? AND status = 'sent' AND bot_id = ?",
            [broadcastId, adminBotId]
        );

        let updatedCount = 0;
        let failedCount = 0;

        for (const msg of messages) {
            try {
                const [uRows] = await pool.execute('SELECT first_name FROM auth WHERE tg_id = ? AND bot_id = ? LIMIT 1', [msg.tg_id, adminBotId]);
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
            "SELECT tg_id, telegram_message_id FROM broadcast_messages WHERE broadcast_id = ? AND status = 'sent' AND bot_id = ?",
            [broadcastId, adminBotId]
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

        await pool.execute('DELETE FROM broadcasts WHERE id = ? AND bot_id = ?', [broadcastId, adminBotId]);

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
            LEFT JOIN auth a ON bm.tg_id = a.tg_id AND a.bot_id = bm.bot_id
            WHERE bm.broadcast_id = ? AND bm.bot_id = ?
            ORDER BY bm.created_at ASC
        `, [broadcastId, adminBotId]);
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
            WHERE bm.id = ? AND bm.status = 'sent' AND bm.bot_id = ?
        `, [msgId, adminBotId]);
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

        await pool.execute('UPDATE broadcast_messages SET custom_message = ? WHERE id = ? AND bot_id = ?', [message, msgId, adminBotId]);

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
            "SELECT tg_id, telegram_message_id FROM broadcast_messages WHERE id = ? AND status = 'sent' AND bot_id = ?",
            [msgId, adminBotId]
        );
        const msgRecord = records[0];

        if (msgRecord) {
            await deleteTelegramMessage(msgRecord.tg_id, msgRecord.telegram_message_id);
        }

        await pool.execute('DELETE FROM broadcast_messages WHERE id = ? AND bot_id = ?', [msgId, adminBotId]);

        return res.json({ success: true });
    } catch (err) {
        console.error('[admin/broadcasts/messages/:msg_id DELETE]', err);
        return res.status(500).json({ error: 'Failed to delete user message' });
    }
});

export default router;
