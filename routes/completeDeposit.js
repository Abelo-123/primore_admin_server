/**
 * Complete Deposit — Verify & Credit Balance
 *
 * POST /api/complete-deposit
 *
 * Called by the frontend after the Chapa inline SDK payment succeeds.
 * Verifies the payment server-side with Chapa API, then credits the user's balance.
 *
 * Request body (JSON):
 *   { tx_ref: string, amount: number, chapa_ref?: string, initData: string }
 *
 * Response:
 *   Verified:  { success: true, new_balance, verified: true }
 *   Pending:   { success: true, pending: true, message: '...' }
 *   Already:   { success: true, new_balance, already_completed: true }
 *
 * Replaces: complete_deposit.php
 */
import { Router } from 'express';
import pool from '../config/database.js';
import { notifyDeposit } from '../lib/notify.js';

const router = Router();

router.post('/', async (req, res) => {
    const conn = await pool.getConnection();

    try {
        const { tx_ref: txRef, amount: rawAmount, chapa_ref: chapaRef, initData } = req.body;
        const amount = parseFloat(rawAmount) || 0;

        // ─── Authenticate user ───────────────────────────────
        const tgId = getTelegramUserId(initData);
        if (!tgId) {
            conn.release();
            return res.json({ success: false, error: 'User not authenticated' });
        }

        if (!txRef) {
            conn.release();
            return res.json({ success: false, error: 'Missing transaction reference' });
        }

        // ─── Begin transaction ───────────────────────────────
        await conn.beginTransaction();

        // Lock the deposit row
        const [deposits] = await conn.execute(
            'SELECT * FROM deposits WHERE tx_ref = ? FOR UPDATE',
            [txRef]
        );
        let deposit = deposits[0];

        // If deposit doesn't exist in DB, create it
        if (!deposit) {
            if (amount > 0) {
                await conn.execute(
                    "INSERT INTO deposits (user_id, amount, tx_ref, status) VALUES (?, ?, ?, 'pending')",
                    [tgId, amount, txRef]
                );

                const [newDeposits] = await conn.execute(
                    'SELECT * FROM deposits WHERE tx_ref = ? FOR UPDATE',
                    [txRef]
                );
                deposit = newDeposits[0];
            } else {
                await conn.rollback();
                conn.release();
                return res.json({ success: false, error: 'Deposit not found' });
            }
        }

        // Already completed — prevent double-crediting
        if (deposit.status === 'success') {
            await conn.commit();

            const [balRows] = await conn.execute(
                'SELECT balance FROM auth WHERE tg_id = ?',
                [deposit.user_id]
            );
            const balance = parseFloat(balRows[0]?.balance) || 0;

            conn.release();
            return res.json({
                success: true,
                new_balance: balance,
                already_completed: true,
            });
        }

        // ─── VERIFY WITH CHAPA API ───────────────────────────
        const chapa = new Chapa();
        const verifyResult = await chapa.verify(txRef);

        const chapaStatus = (verifyResult.data?.status ?? '').toLowerCase();

        if (verifyResult.success && (chapaStatus === 'success' || chapaStatus === 'paid')) {
            // Use Chapa's VERIFIED amount (security: never trust frontend amount)
            const verifiedAmount = parseFloat(verifyResult.data?.amount) || deposit.amount;
            const verifiedChapaRef = verifyResult.data?.reference || chapaRef || '';
            const responseJson = JSON.stringify(verifyResult.raw);

            // Update deposit status
            await conn.execute(
                "UPDATE deposits SET status = 'success', chapa_tx_ref = ?, chapa_response = ?, completed_at = NOW() WHERE id = ?",
                [verifiedChapaRef, responseJson, deposit.id]
            );

            // Credit user balance
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

            // Record transaction in ledger
            await conn.execute(
                `INSERT INTO transactions (user_id, type, amount, balance_after, reference_type, reference_id, description)
                 VALUES (?, 'deposit', ?, ?, 'deposit', ?, 'Chapa deposit')`,
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

            return res.json({
                success: true,
                new_balance: newBalance,
                verified: true,
            });
        } else {
            // Chapa hasn't confirmed yet — leave as pending, callback will handle later
            await conn.commit();
            conn.release();

            console.log(
                `[complete_deposit] Chapa verification for ${txRef}: ${verifyResult.data?.status ?? 'No status'}`
            );

            return res.json({
                success: true,
                pending: true,
                message: 'Payment is being processed. Your balance will update shortly.',
            });
        }
    } catch (err) {
        try { await conn.rollback(); } catch {}
        conn.release();
        console.error('[complete_deposit] Error:', err);
        return res.json({ success: false, error: 'System error: ' + err.message });
    }
});

export default router;
