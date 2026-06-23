import { Router } from 'express';
import pool from '../config/database.js';
import { getBotIdAndUser } from '../lib/auth.js';
import { notifyNewUser } from '../lib/notify.js';

const router = Router();

// get_settings
router.get('/settings', async (req, res) => {
    try {
        const initData = req.query.initData || '';
        const reqBotId = req.body?.bot_id || req.query?.bot_id || req.headers?.['x-bot-id'] || null;
        const { botId } = getBotIdAndUser(initData, reqBotId);
        let [rows] = await pool.execute('SELECT setting_key, setting_value FROM settings WHERE bot_id = ?', [botId]);
        
        if (rows.length === 0) {
            // Seed settings by copying settings from another bot if any exist
            const [anySettings] = await pool.execute('SELECT DISTINCT bot_id FROM settings LIMIT 1');
            if (anySettings.length > 0) {
                const sourceBotId = anySettings[0].bot_id;
                const [sourceRows] = await pool.execute('SELECT setting_key, setting_value FROM settings WHERE bot_id = ?', [sourceBotId]);
                for (const s of sourceRows) {
                    await pool.execute('INSERT IGNORE INTO settings (setting_key, bot_id, setting_value) VALUES (?, ?, ?)', [s.setting_key, botId, s.setting_value]);
                }
                [rows] = await pool.execute('SELECT setting_key, setting_value FROM settings WHERE bot_id = ?', [botId]);
            }
        }

        const settings = {
            rateMultiplier: 55,
            discountPercent: 0,
            holidayName: '',
            maintenanceMode: false,
            userCanOrder: true,
            marqueeText: 'Welcome to Paxyo SMM!',
            topServicesIds: [],
            botUsername: 'eertert_bot'
        };
        
        rows.forEach(row => {
            if (row.setting_key === 'rate_multiplier') settings.rateMultiplier = parseFloat(row.setting_value) || 55;
            if (row.setting_key === 'discount_percent') settings.discountPercent = parseFloat(row.setting_value) || 0;
            if (row.setting_key === 'holiday_name') settings.holidayName = row.setting_value;
            if (row.setting_key === 'maintenance_mode') settings.maintenanceMode = (row.setting_value === '1' || row.setting_value === 'true');
            if (row.setting_key === 'user_can_order') settings.userCanOrder = (row.setting_value === '1' || row.setting_value === 'true');
            if (row.setting_key === 'marquee_text') settings.marqueeText = row.setting_value;
            if (row.setting_key === 'bot_username') settings.botUsername = row.setting_value || 'eertert_bot';
            if (row.setting_key === 'top_services_ids') {
                settings.topServicesIds = row.setting_value
                    ? row.setting_value.split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n))
                    : [];
            }
        });

        return res.json(settings);
    } catch (err) {
        console.error(err);
        return res.json({ rateMultiplier: 55, discountPercent: 0, holidayName: '', maintenanceMode: false, userCanOrder: true, marqueeText: '', topServicesIds: [], botUsername: 'eertert_bot' });
    }
});

// get_recommended - now uses top_services_ids from settings
router.get('/recommended', async (req, res) => {
    try {
        const initData = req.query.initData || '';
        const reqBotId = req.body?.bot_id || req.query?.bot_id || req.headers?.['x-bot-id'] || null;
        const { botId } = getBotIdAndUser(initData, reqBotId);
        const [rows] = await pool.execute(
            'SELECT setting_value FROM settings WHERE setting_key = "top_services_ids" AND bot_id = ?',
            [botId]
        );
        if (rows.length > 0 && rows[0].setting_value) {
            const ids = rows[0].setting_value
                .split(',')
                .map(s => parseInt(s.trim(), 10))
                .filter(n => !isNaN(n));
            return res.json(ids);
        }
        return res.json([]);
    } catch (err) {
        console.error(err);
        return res.json([]);
    }
});

// get alerts
router.post('/alerts', async (req, res) => {
    const { initData } = req.body;
    const reqBotId = req.body?.bot_id || req.query?.bot_id || req.headers?.['x-bot-id'] || null;
    const { botId, user } = getBotIdAndUser(initData, reqBotId);
    const tgId = user?.id ? String(user.id) : null;
    if (!tgId) return res.json({ success: false, unreadCount: 0, alerts: [] });

    try {
        const [alerts] = await pool.execute('SELECT * FROM alerts WHERE user_id = ? AND bot_id = ? ORDER BY created_at DESC LIMIT 50', [tgId, botId]);
        const unreadCount = alerts.filter(a => a.is_read === 0 || a.is_read === false).length;
        return res.json({ success: true, unreadCount, alerts });
    } catch (err) {
        console.error(err);
        return res.json({ success: false, unreadCount: 0, alerts: [] });
    }
});

// mark alerts read
router.post('/alerts/mark-read', async (req, res) => {
    const { initData } = req.body;
    const reqBotId = req.body?.bot_id || req.query?.bot_id || req.headers?.['x-bot-id'] || null;
    const { botId, user } = getBotIdAndUser(initData, reqBotId);
    const tgId = user?.id ? String(user.id) : null;
    if (!tgId) return res.json({ success: false });

    try {
        await pool.execute('UPDATE alerts SET is_read = 1 WHERE user_id = ? AND bot_id = ?', [tgId, botId]);
        return res.json({ success: true });
    } catch (err) {
        console.error(err);
        return res.json({ success: false });
    }
});

// auth (for telegram_auth.php)
router.post('/auth', async (req, res) => {
    const { initData } = req.body;
    const reqBotId = req.body?.bot_id || req.query?.bot_id || req.headers?.['x-bot-id'] || null;
    const { botId, user: tgUser } = getBotIdAndUser(initData, reqBotId);
    const tgId = tgUser?.id ? String(tgUser.id) : null;
    
    if (!tgId) return res.status(401).json({ success: false });

    const firstName = tgUser.first_name || '';
    const lastName = tgUser.last_name || '';
    const username = tgUser.username || '';
    const photoUrl = tgUser.photo_url || '';

    try {
        let [users] = await pool.execute('SELECT * FROM auth WHERE tg_id = ? AND bot_id = ?', [tgId, botId]);
        if (users.length === 0) {
            await pool.execute(
                "INSERT INTO auth (tg_id, bot_id, username, first_name, last_name, photo_url, balance, auth_provider, last_login) VALUES (?, ?, ?, ?, ?, ?, 0.00, 'telegram', NOW())", 
                [tgId, botId, username, firstName, lastName, photoUrl]
            );
            [users] = await pool.execute('SELECT * FROM auth WHERE tg_id = ? AND bot_id = ?', [tgId, botId]);
            
            // Notify new user registration
            notifyNewUser({ uid: tgId, uuid: username || firstName });
        } else {
            await pool.execute(
                'UPDATE auth SET username = ?, first_name = ?, last_name = ?, photo_url = ?, last_login = NOW() WHERE tg_id = ? AND bot_id = ?', 
                [username, firstName, lastName, photoUrl, tgId, botId]
            );
        }
        const user = users[0];
        
        return res.json({ 
            success: true, 
            user: {
                id: user.tg_id, // we return tg_id as id for frontend compatibility
                tg_id: user.tg_id,
                username: user.username || username,
                first_name: user.first_name || firstName,
                last_name: user.last_name || lastName,
                photo_url: user.photo_url || photoUrl,
                balance: parseFloat(user.balance),
                role: user.role || 'user'
            }
        });
    } catch (err) {
        console.error(err);
        return res.json({ success: false, error: err.message });
    }
});

// log-init-data
router.post('/log-init-data', async (req, res) => {
    // This endpoint can be phased out as /auth handles all user info now,
    // but returning success to ensure backward compatibility.
    return res.json({ success: true });
});

// heartbeat
router.get('/heartbeat', async (req, res) => {
    return res.json({ ok: 1 });
});

export default router;
