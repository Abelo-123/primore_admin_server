/**
 * Reseller Deposit — Admin Chapa Payment
 *
 * Allows the primora admin to top up their reseller_balance via Chapa.
 * Unlike user deposits, this uses admin-level auth (Bearer token) not Telegram initData.
 *
 * Routes:
 *   POST /api/admin/reseller/deposit/init       — Init Chapa payment (admin auth)
 *   GET  /api/admin/reseller/deposit/callback   — Chapa webhook (no auth)
 *   POST /api/admin/reseller/deposit/callback   — Chapa webhook (no auth)
 *   POST /api/admin/reseller/deposit/verify     — Frontend polling fallback (admin auth)
 *   GET  /api/admin/reseller/deposit/history    — List all reseller deposits (admin auth)
 *   GET  /api/admin/reseller/public-status      — Balance info for joadmin to query (API key auth)
 */
import { Router } from 'express';
import crypto from 'crypto';
import pool from '../config/database.js';
import Chapa from '../lib/chapa.js';

const router = Router();

const botToken = process.env.BOT_TOKEN || '';
const adminBotId = botToken ? botToken.split(':')[0] : '';
const JOADMIN_SERVER_URL = process.env.JOADMIN_SERVER_URL || 'https://padmin121.onrender.com';
const JOADMIN_API_KEY = process.env.JOADMIN_API_KEY || process.env.GODOFPANEL_API_KEY || '';
const RESELLER_ID = process.env.RESELLER_ID || 'primore';
const SITE_URL = process.env.SITE_URL || 'https://primore-admin-server.onrender.com';

// ─── Admin auth middleware ─────────────────────────────────────────
async function getAdminPassword() {
    try {
        const [rows] = await pool.execute(
            "SELECT setting_value FROM settings WHERE setting_key = 'admin_password' AND bot_id = ? LIMIT 1",
            [adminBotId]
        );
        if (rows.length > 0 && rows[0].setting_value) return rows[0].setting_value;
    } catch (e) {}
    return process.env.ADMIN_PASSWORD || 'primora2026';
}

function requireAdmin(publicPaths = []) {
    return async (req, res, next) => {
        // Skip auth for public paths
        if (publicPaths.some(p => req.path === p || req.path.startsWith(p))) {
            return next();
        }
        const authHeader = req.headers.authorization || '';
        const adminPass = await getAdminPassword();
        let providedPass = '';
        const match = authHeader.match(/Bearer\s+(.*)$/i);
        if (match) {
            providedPass = match[1];
            if (providedPass.includes(':')) {
                const parts = providedPass.split(':');
                providedPass = parts.length >= 4 ? parts[1] : (parts.length === 2 ? parts[1] : providedPass);
            }
        }
        if (!providedPass || providedPass !== adminPass) {
            return res.status(401).json({ error: 'Unauthorized' });
        }
        next();
    };
}

// Apply admin auth (skip callback, public-status, and test-init)
router.use(requireAdmin(['/callback', '/public-status', '/test-init']));

router.get('/test-init', (req, res) => {
    return res.json({ success: true, message: "Reseller deposit router is fully active!" });
});

// ─── Ensure reseller_deposits table exists ─────────────────────────
async function ensureTable() {
    try {
        const conn = await pool.getConnection();
        await conn.execute(`
            CREATE TABLE IF NOT EXISTS reseller_deposits (
                id INT AUTO_INCREMENT PRIMARY KEY,
                amount DECIMAL(10, 2) NOT NULL,
                tx_ref VARCHAR(255) NOT NULL UNIQUE,
                status VARCHAR(50) DEFAULT 'pending',
                chapa_tx_ref VARCHAR(255),
                chapa_response TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                completed_at DATETIME
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `);
        conn.release();
    } catch (e) {
        console.error('[resellerDeposit] table ensure error:', e.message);
    }
}
ensureTable();

// ─── POST /init — Initialize Chapa payment ─────────────────────────
router.post('/init', async (req, res) => {
    try {
        const { amount: rawAmount, first_name, last_name, email } = req.body;
        const amount = parseFloat(rawAmount) || 0;

        const MIN = parseFloat(process.env.MIN_DEPOSIT) || 10;
        const MAX = parseFloat(process.env.MAX_DEPOSIT) || 100000;

        if (!amount || amount < MIN) {
            return res.status(400).json({ success: false, error: `Minimum deposit is ${MIN} ETB` });
        }
        if (amount > MAX) {
            return res.status(400).json({ success: false, error: `Maximum deposit is ${MAX.toLocaleString()} ETB` });
        }

        const txRef = `RADM-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;

        // Insert pending record
        await pool.execute(
            "INSERT INTO reseller_deposits (amount, tx_ref, status) VALUES (?, ?, 'pending')",
            [amount, txRef]
        );

        // Initialize Chapa with reseller-specific callback URL
        const chapaCallbackUrl = `${SITE_URL}/api/admin/reseller/deposit/callback`;
        const chapaReturnUrl = `${SITE_URL}/api/admin/reseller/deposit/callback?tx_ref=${txRef}`;

        const chapa = new Chapa();
        const result = await chapa.initialize({
            amount,
            email: email || 'admin@primore.com',
            first_name: first_name || 'Admin',
            last_name: last_name || '',
            tx_ref: txRef,
            callback_url: chapaCallbackUrl,
            return_url: chapaReturnUrl
        });

        console.log('[Chapa Init] Result:', JSON.stringify(result, null, 2));

        if (result.success && result.data?.checkout_url) {
            await pool.execute(
                'UPDATE reseller_deposits SET status = ? WHERE tx_ref = ?',
                ['initiated', txRef]
            );
            return res.json({
                success: true,
                checkout_url: result.data.checkout_url,
                tx_ref: txRef,
            });
        } else {
            // Clean up failed record
            await pool.execute('DELETE FROM reseller_deposits WHERE tx_ref = ?', [txRef]);
            const errorMsg = result.message || 'Failed to initialize Chapa payment';
            return res.status(400).json({
                success: false,
                error: `Chapa Error: ${errorMsg}`,
            });
        }
    } catch (err) {
        console.error('[reseller/deposit/init]', err);
        return res.status(500).json({ success: false, error: 'System error: ' + err.message });
    }
});

// ─── Shared callback handler ───────────────────────────────────────
async function handleDepositCallback(txRef) {
    if (!txRef) return { success: false, message: 'Missing tx_ref' };

    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();

        // Lock the deposit row
        const [rows] = await conn.execute(
            "SELECT * FROM reseller_deposits WHERE tx_ref = ? AND status NOT IN ('success') FOR UPDATE",
            [txRef]
        );
        const deposit = rows[0];

        if (!deposit) {
            await conn.rollback();
            conn.release();
            return { success: true, message: 'Already processed or not found' };
        }

        // Verify with Chapa
        const chapa = new Chapa();
        const result = await chapa.verify(txRef);
        const chapaStatus = (result.data?.status ?? '').toLowerCase();

        if (result.success && (chapaStatus === 'success' || chapaStatus === 'paid')) {
            const verifiedAmount = parseFloat(result.data?.amount) || parseFloat(deposit.amount);
            const chapaRef = result.data?.reference || '';
            const responseJson = JSON.stringify(result.raw);

            // Mark deposit as success
            await conn.execute(
                "UPDATE reseller_deposits SET status = 'success', chapa_tx_ref = ?, chapa_response = ?, completed_at = NOW() WHERE id = ?",
                [chapaRef, responseJson, deposit.id]
            );

            // Credit reseller_balance
            await conn.execute(
                'INSERT INTO settings (setting_key, bot_id, setting_value) VALUES ("reseller_balance", ?, ?) ON DUPLICATE KEY UPDATE setting_value = CAST(CAST(setting_value AS DECIMAL(10,2)) + ? AS CHAR)',
                [adminBotId, verifiedAmount.toFixed(2), verifiedAmount]
            );

            await conn.commit();
            conn.release();

            console.log(`[reseller/deposit] Credited ${verifiedAmount} ETB to reseller_balance (tx: ${txRef})`);
            return { success: true, message: 'Reseller balance credited', amount: verifiedAmount };
        } else {
            await conn.execute(
                "UPDATE reseller_deposits SET status = 'failed' WHERE id = ?",
                [deposit.id]
            );
            await conn.commit();
            conn.release();
            return { success: false, message: 'Payment verification failed or still pending' };
        }
    } catch (err) {
        try { await conn.rollback(); } catch {}
        conn.release();
        console.error('[reseller/deposit/callback]', err);
        return { success: false, message: 'System error: ' + err.message };
    }
}

// ─── GET/POST /callback — Chapa webhook ───────────────────────────
router.get('/callback', async (req, res) => {
    const txRef = req.query.tx_ref || req.query.trx_ref || '';
    const result = await handleDepositCallback(txRef);
    return res.json(result);
});

router.post('/callback', async (req, res) => {
    const txRef = req.body?.tx_ref || req.body?.trx_ref || req.query?.tx_ref || '';
    const result = await handleDepositCallback(txRef);
    return res.json(result);
});

// ─── POST /verify — Frontend polling fallback ──────────────────────
router.post('/verify', async (req, res) => {
    const { tx_ref: txRef } = req.body;
    if (!txRef) return res.status(400).json({ success: false, error: 'tx_ref required' });

    const result = await handleDepositCallback(txRef);

    // Also return current reseller_balance
    try {
        const [rows] = await pool.execute(
            'SELECT setting_value FROM settings WHERE setting_key = "reseller_balance" AND bot_id = ?',
            [adminBotId]
        );
        const balance = rows.length > 0 ? parseFloat(rows[0].setting_value || '0') : 0;
        return res.json({ ...result, reseller_balance: balance });
    } catch (e) {
        return res.json(result);
    }
});

// ─── GET /history — List all reseller deposits ─────────────────────
router.get('/history', async (req, res) => {
    try {
        const [rows] = await pool.execute(
            'SELECT * FROM reseller_deposits ORDER BY created_at DESC LIMIT 50'
        );
        return res.json({ success: true, deposits: rows });
    } catch (err) {
        console.error('[reseller/deposit/history]', err);
        return res.status(500).json({ success: false, error: 'Failed to load deposit history' });
    }
});

// ─── GET /public-status — For joadmin to query (API key auth) ─────
router.get('/public-status', async (req, res) => {
    const providedKey = req.query.key || req.headers['x-api-key'] || '';
    if (!JOADMIN_API_KEY || providedKey !== JOADMIN_API_KEY) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    try {
        const [rows] = await pool.execute(
            'SELECT setting_key, setting_value FROM settings WHERE setting_key IN ("reseller_balance", "total_deposit") AND bot_id = ?',
            [adminBotId]
        );
        const data = {};
        rows.forEach(r => { data[r.setting_key] = parseFloat(r.setting_value || '0'); });
        return res.json({
            success: true,
            reseller_id: RESELLER_ID,
            reseller_balance: data.reseller_balance || 0,
            total_deposit: data.total_deposit || 0,
        });
    } catch (err) {
        console.error('[reseller/public-status]', err);
        return res.status(500).json({ error: 'Failed to fetch status' });
    }
});

export default router;
