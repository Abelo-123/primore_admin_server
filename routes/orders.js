import { Router } from 'express';
import pool from '../config/database.js';
import { getTelegramUserId } from '../lib/auth.js';
import { notifyNewOrder } from '../lib/notify.js';

const router = Router();

// placeOrder: POST /api/orders/place
router.post('/place', async (req, res) => {
    try {
        const { service, link, quantity, initData, answer_number, comments } = req.body;
        
        const tgId = getTelegramUserId(initData);
        if (!tgId) {
            return res.status(401).json({ success: false, error: 'User not authenticated' });
        }

        const apiKey = process.env.GODOFPANEL_API_KEY;
        if (!apiKey) return res.status(500).json({ success: false, error: 'Provider API key missing' });

        const conn = await pool.getConnection();
        try {
            await conn.beginTransaction();
            
            // 1. Get rate multiplier
            const [settingsRows] = await conn.execute('SELECT setting_value FROM settings WHERE setting_key = "rate_multiplier"');
            const rateMultiplier = settingsRows.length > 0 ? parseFloat(settingsRows[0].setting_value) : 55.0;

            // 2. Lock user row to prevent race conditions
            const [userRows] = await conn.execute('SELECT * FROM auth WHERE tg_id = ? FOR UPDATE', [tgId]);
            const user = userRows[0];
            if (!user) {
                await conn.rollback();
                return res.json({ success: false, error: 'User not found' });
            }

            // 3. Fetch specific service from GodOfPanel
            // Actually, we should fetch services, but since GOP API is slow and we don't know the rate of this single service easily,
            // We can fetch from GOP: action=services
            const gopRes = await fetch(`https://godofpanel.com/api/v2?key=${apiKey}&action=services`);
            const allServices = await gopRes.json();
            const serviceData = allServices.find(s => parseInt(s.service) === parseInt(service));

            if (!serviceData) {
                await conn.rollback();
                return res.json({ success: false, error: 'Service not found or unavailable' });
            }

            // Calculate cost
            const unitRateUsd = parseFloat(serviceData.rate);
            const totalCostUsd = unitRateUsd * (quantity / 1000);
            const totalCostEtb = totalCostUsd * rateMultiplier;

            if (parseFloat(user.balance) < totalCostEtb) {
                await conn.rollback();
                return res.json({ success: false, error: 'Insufficient balance' });
            }

            // 4. Place order to GodOfPanel
            const orderParams = new URLSearchParams({
                key: apiKey,
                action: 'add',
                service: service.toString(),
                link: link,
                quantity: quantity.toString()
            });
            if (comments) orderParams.append('comments', comments);
            if (answer_number) orderParams.append('answer_number', answer_number.toString());

            const orderRes = await fetch('https://godofpanel.com/api/v2', {
                method: 'POST',
                body: orderParams
            });
            const orderData = await orderRes.json();

            if (orderData.error) {
                await conn.rollback();
                return res.json({ success: false, error: orderData.error });
            }

            const providerOrderId = orderData.order;

            // 5. Update user balance
            await conn.execute('UPDATE auth SET balance = balance - ?, last_order = NOW(), total_spent = total_spent + ? WHERE tg_id = ?', [totalCostEtb, totalCostEtb, tgId]);

            // Get new balance
            const [newBalRows] = await conn.execute('SELECT balance FROM auth WHERE tg_id = ?', [tgId]);
            const newBalanceStr = newBalRows[0].balance;

            // 6. Insert Order into DB
            const [insertRes] = await conn.execute(
                `INSERT INTO orders 
                 (user_id, service_id, target_link, quantity, provider_order_id, cost, status, created_at) 
                 VALUES (?, ?, ?, ?, ?, ?, 'pending', NOW())`,
                [tgId, service, link, quantity, providerOrderId, totalCostEtb]
            );

            // 7. Log Transaction
            await conn.execute(
                `INSERT INTO transactions 
                 (user_id, type, amount, balance_after, reference_type, reference_id, description)
                 VALUES (?, 'order', ?, ?, 'order', ?, 'Placed Order #${insertRes.insertId}')`,
                [tgId, -totalCostEtb, newBalanceStr, insertRes.insertId]
            );

            await conn.commit();

            // Notify admin bot
            const orderId = insertRes.insertId.toString();
            notifyNewOrder({
                uid: tgId,
                uuid: user.username || user.first_name || 'User',
                service: serviceData.name,
                order: orderId,
                amount: totalCostEtb.toString()
            });

            return res.json({ success: true, order_id: orderId, new_balance: parseFloat(newBalanceStr) });
        } catch (err) {
            await conn.rollback();
            console.error('[place_order]', err);
            return res.status(500).json({ success: false, error: 'Database error' });
        } finally {
            conn.release();
        }
    } catch (err) {
        console.error('[place_order]', err);
        return res.status(500).json({ success: false, error: 'System error' });
    }
});

// getOrders
router.post('/list', async (req, res) => {
    const { initData } = req.body;
    const tgId = getTelegramUserId(initData);
    if (!tgId) return res.status(401).json({ error: 'Not authenticated' });

    try {
        const [rows] = await pool.execute(
            'SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC LIMIT 100',
            [tgId]
        );
        return res.json({ success: true, orders: rows });
    } catch (err) {
        console.error(err);
        return res.json({ success: false, orders: [] });
    }
});

// checkOrderStatus
router.post('/status', async (req, res) => {
    const { initData } = req.body;
    const tgId = getTelegramUserId(initData);
    if (!tgId) return res.status(401).json({ error: 'Not authenticated' });

    try {
        // Find pending/in_progress orders for this user
        const [orders] = await pool.execute(
            "SELECT id, provider_order_id FROM orders WHERE user_id = ? AND status IN ('pending', 'in_progress', 'processing')",
            [tgId]
        );

        if (orders.length === 0) return res.json({ success: true, updated: [] });

        const apiKey = process.env.GODOFPANEL_API_KEY;
        const reqOrderIds = orders.map(o => o.provider_order_id).join(',');
        
        const gopRes = await fetch(`https://godofpanel.com/api/v2?key=${apiKey}&action=status&orders=${reqOrderIds}`);
        const statusMap = await gopRes.json();

        const updated = [];
        for (const order of orders) {
            const providerStatus = statusMap[order.provider_order_id];
            if (providerStatus && providerStatus.status) {
                const newStatus = providerStatus.status.toLowerCase();
                await pool.execute('UPDATE orders SET status = ?, start_count = ?, remains = ? WHERE id = ?', 
                    [newStatus, providerStatus.start_count || 0, providerStatus.remains || 0, order.id]);
                updated.push({ id: order.id, status: newStatus });
            }
        }

        return res.json({ success: true, updated });
    } catch (err) {
        console.error(err);
        return res.json({ success: false, error: 'Sync failed' });
    }
});

// requestRefill
router.post('/refill', async (req, res) => {
    const { initData, order_id } = req.body;
    const tgId = getTelegramUserId(initData);
    if (!tgId) return res.status(401).json({ error: 'Not authenticated' });

    try {
        // Find provider order ID
        const [orders] = await pool.execute('SELECT provider_order_id FROM orders WHERE id = ? AND user_id = ?', [order_id, tgId]);
        if (!orders[0]) return res.json({ success: false, message: 'Order not found' });

        const apiKey = process.env.GODOFPANEL_API_KEY;
        const gopRes = await fetch(`https://godofpanel.com/api/v2?key=${apiKey}&action=refill&order=${orders[0].provider_order_id}`);
        const refillData = await gopRes.json();

        if (refillData.error) return res.json({ success: false, message: refillData.error });
        return res.json({ success: true, message: 'Refill requested' });
    } catch (err) {
        return res.json({ success: false, message: 'Failed to request refill' });
    }
});

export default router;
