/**
 * Admin Routes — Paxyo Admin Panel Backend
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

        return res.json({
            totalUsers: Number(totalUsers),
            totalOrders: Number(totalOrders),
            totalDeposits: Number(totalDeposits),
            totalRevenue: Number(totalRevenue),
            recentOrders,
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

        let whereClause = '';
        let params = [];

        if (search) {
            whereClause = 'WHERE tg_id LIKE ? OR username LIKE ? OR first_name LIKE ? OR last_name LIKE ?';
            const s = `%${search}%`;
            params = [s, s, s, s];
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

        // Log the transaction
        await pool.execute(
            `INSERT INTO transactions (user_id, type, amount, balance_after, reference_type, description, created_at)
             VALUES (?, 'admin_adjustment', ?, ?, 'admin', 'Admin balance adjustment', NOW())`,
            [tg_id, amount, user.balance]
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
            // Broadcast to every user
            await pool.execute(
                `INSERT INTO alerts (user_id, title, message, type)
                 SELECT tg_id, ?, ?, ? FROM auth`,
                [title, message, type]
            );
        } else {
            // Send to a specific user by tg_id
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

        return res.json({ orders, total: Number(total) });
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

// ─── Settings ───────────────────────────────────────────────────
router.get('/settings', async (req, res) => {
    try {
        const [rows] = await pool.execute('SELECT setting_key, setting_value FROM settings');
        const settings = {};
        rows.forEach(r => { settings[r.setting_key] = r.setting_value; });

        return res.json({
            rate_multiplier: settings.rate_multiplier || '55',
            discount_percent: settings.discount_percent || '0',
            holiday_name: settings.holiday_name || '',
            maintenance_mode: settings.maintenance_mode || '0',
            user_can_order: settings.user_can_order || '1',
            marquee_text: settings.marquee_text || '',
            top_services_ids: settings.top_services_ids || '',
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

        // Upsert: INSERT ... ON DUPLICATE KEY UPDATE
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

// ─── Service Custom Pricing ────────────────────────────────────────
router.get('/services/custom', async (req, res) => {
    try {
        const [rows] = await pool.execute('SELECT * FROM service_custom ORDER BY updated_at DESC');
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
        return res.status(500).json({ error: 'Failed to update custom pricing' });
    }
});

router.delete('/services/custom/:serviceId', async (req, res) => {
    try {
        const { serviceId } = req.params;
        await pool.execute('DELETE FROM service_custom WHERE service_id = ?', [serviceId]);
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
             LEFT JOIN auth a ON sc.updated_by = a.tg_id
             ORDER BY sc.updated_at DESC LIMIT 20`
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
            'SELECT * FROM service_custom WHERE is_enabled = FALSE ORDER BY updated_at DESC'
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

            // Update status to done
            await conn.execute('UPDATE withdrawals SET status = \'done\' WHERE id = ?', [id]);

            // Notify user
            await conn.execute(
                'INSERT INTO alerts (user_id, title, message, type) VALUES (?, ?, ?, \'success\')',
                [w.user_id, 'Withdrawal Done', `Your withdrawal request of ${parseFloat(w.amount).toFixed(2)} ETB has been marked as DONE and transferred to your bank account!`, 'success']
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

export default router;
