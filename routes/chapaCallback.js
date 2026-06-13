/**
 * Chapa Callback — Server-to-server notification
 *
 * GET/POST /api/chapa-callback
 *
 * This is the SAFETY NET. Chapa calls this URL after a payment is completed.
 * Even if the user closes the browser, this will credit the balance.
 *
 * Parameters:
 *   tx_ref (via GET query or POST body)
 *
 * No authentication required (called by Chapa's servers).
 *
 * Replaces: chapa_callback.php
 */
import { Router } from 'express';
import pool from '../config/database.js';
import Chapa from '../lib/chapa.js';
import { notifyDeposit } from '../lib/notify.js';

const router = Router();

async function handleCallback(req, res) {
    // Extract tx_ref from GET or POST
    const txRef =
        req.query?.trx_ref ||
        req.query?.tx_ref ||
        req.body?.tx_ref ||
        req.body?.trx_ref ||
        '';

    if (!txRef) {
        return res.json({ success: false, message: 'Missing tx_ref' });
    }

    const conn = await pool.getConnection();

    try {
        await conn.beginTransaction();

        // Lock the deposit row
        const [pendingDeposits] = await conn.execute(
            "SELECT * FROM deposits WHERE tx_ref = ? AND status = 'pending' FOR UPDATE",
            [txRef]
        );
        const deposit = pendingDeposits[0];

        if (!deposit) {
            await conn.rollback();
            conn.release();
            return res.json({ success: false, message: 'No pending deposit found' });
        }

        // Verify with Chapa API
        const chapa = new Chapa();
        const result = await chapa.verify(txRef);

        const chapaStatus = (result.data?.status ?? '').toLowerCase();

        if (result.success && (chapaStatus === 'success' || chapaStatus === 'paid')) {
            const verifiedAmount = parseFloat(result.data?.amount) || deposit.amount;
            const chapaRef = result.data?.reference || '';
            const responseJson = JSON.stringify(result.raw);

            // Update deposit
            await conn.execute(
                "UPDATE deposits SET status = 'success', chapa_tx_ref = ?, chapa_response = ?, completed_at = NOW() WHERE id = ?",
                [chapaRef, responseJson, deposit.id]
            );

            // Credit balance
            await conn.execute(
                'UPDATE auth SET balance = balance + ?, last_deposit = NOW() WHERE tg_id = ?',
                [verifiedAmount, deposit.user_id]
            );

            // Get new balance
            const [balRows] = await conn.execute(
                'SELECT balance FROM auth WHERE tg_id = ?',
                [deposit.user_id]
            );
            const newBalance = parseFloat(balRows[0]?.balance) || 0;

            // Record transaction
            await conn.execute(
                `INSERT INTO transactions (user_id, type, amount, balance_after, reference_type, reference_id, description)
                 VALUES (?, 'deposit', ?, ?, 'deposit', ?, 'Chapa deposit (callback)')`,
                [deposit.user_id, verifiedAmount, newBalance, deposit.id]
            );

            await conn.commit();
            conn.release();

            // Notify admin bot
            notifyDeposit({
                uid: deposit.user_id,
                amount: verifiedAmount.toString(),
                uuid: 'Chapa'
            });

            return res.json({ success: true, message: 'Deposit completed successfully' });
        } else {
            // Mark as failed
            await conn.execute(
                "UPDATE deposits SET status = 'failed' WHERE id = ?",
                [deposit.id]
            );

            await conn.commit();
            conn.release();
            return res.json({ success: false, message: 'Payment verification failed' });
        }
    } catch (err) {
        try { await conn.rollback(); } catch {}
        conn.release();
        console.error('[chapa_callback] Error:', err);
        return res.json({ success: false, message: 'System error' });
    }
}

router.get('/', handleCallback);
router.post('/', handleCallback);

export default router;
