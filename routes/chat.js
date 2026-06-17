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

            // Notify admin bot
            let firstName = 'User';
            try {
                const [rows] = await pool.execute('SELECT first_name FROM auth WHERE tg_id = ? LIMIT 1', [tgId]);
                if (rows.length > 0 && rows[0].first_name) {
                    firstName = rows[0].first_name;
                }
            } catch (err) {}

            const botToken = '8662579997:AAHp2xw6pZLOcfHumSWfmT3BsU8NMsfMA0Y';
            const adminUserIds = [5928771903, 779060335, 460529558];
            const telegramText = `💬 Chat: ${firstName} (${tgId}) - "${message}"`;

            for (const adminId of adminUserIds) {
                const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
                const body = {
                    chat_id: String(adminId),
                    text: telegramText,
                    parse_mode: 'HTML'
                };
                await fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body)
                }).catch(e => console.error('Failed to notify admin:', e.message));
            }

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
