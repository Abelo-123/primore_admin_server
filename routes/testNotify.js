import { Router } from 'express';
import { notifyNewOrder, notifyDeposit, sendNotification } from '../lib/notify.js';

const router = Router();

// Test notification endpoint for debugging
router.post('/test-notify', async (req, res) => {
    const { type, ...params } = req.body;
    
    if (!type) {
        return res.json({ error: 'type is required (neworder, deposit, newuser)' });
    }
    
    try {
        if (type === 'neworder') {
            await notifyNewOrder({
                uid: params.uid || '123456789',
                uuid: params.uuid || 'Test User',
                service: params.service || 'Instagram Followers',
                order: params.order || '12345',
                amount: params.amount || '100'
            });
        } else if (type === 'deposit') {
            await notifyDeposit({
                uid: params.uid || '123456789',
                amount: params.amount || '500',
                uuid: params.uuid || 'Chapa'
            });
        } else {
            await sendNotification(type, params);
        }
        
        return res.json({ success: true, message: `Notification ${type} sent` });
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
});

export default router;