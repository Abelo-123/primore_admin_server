/**
 * Get Balance — Fetch user's current wallet balance
 *
 * POST /api/balance
 *
 * Request body (JSON):
 *   { initData: string }
 *
 * Response:
 *   { success: true, balance: number }
 *
 * Replaces: get_balance.php
 */
import { Router } from 'express';
import pool from '../config/database.js';
import { getBotIdAndUser } from '../lib/auth.js';

const router = Router();

router.post('/', async (req, res) => {
    try {
        const initData = req.body?.initData || '';

        const { botId, user } = getBotIdAndUser(initData);
        const tgId = user?.id ? String(user.id) : null;
        if (!tgId) {
            return res.json({ success: false, error: 'User not authenticated' });
        }

        const [rows] = await pool.execute('SELECT balance FROM auth WHERE tg_id = ? AND bot_id = ?', [tgId, botId]);

        const balance = rows.length > 0 ? parseFloat(rows[0].balance) : 0;

        return res.json({
            success: true,
            balance,
        });
    } catch (err) {
        console.error('[get_balance] Error:', err);
        return res.json({ 
            success: false, 
            error: 'Database error',
            debug: err.message,
            code: err.code
        });
    }
});

export default router;
