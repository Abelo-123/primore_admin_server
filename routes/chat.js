import { Router } from 'express';
import pool from '../config/database.js';
import { getTelegramUserId } from '../lib/auth.js';

const router = Router();

router.post('/', async (req, res) => {
    const { initData, action, message } = req.body;
    const tgId = getTelegramUserId(initData);
    if (!tgId) return res.status(401).json({ success: false, error: 'Not authenticated' });

    try {
        if (action === 'send') {
            await pool.execute(
                'INSERT INTO chat_messages (user_id, message, is_admin, created_at) VALUES (?, ?, 0, NOW())',
                [tgId, message]
            );
            return res.json({ success: true });
        } else if (action === 'fetch') {
            const [messages] = await pool.execute(
                'SELECT * FROM chat_messages WHERE user_id = ? ORDER BY created_at ASC LIMIT 100',
                [tgId]
            );
            return res.json({ success: true, messages });
        }
        return res.json({ success: false, error: 'Invalid action' });
    } catch (err) {
        console.error(err);
        // Table might not exist yet, return empty
        if (action === 'fetch') return res.json({ success: true, messages: [] });
        return res.json({ success: false });
    }
});

export default router;
