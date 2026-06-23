/**
 * seed_bot_8731737556.js
 * ──────────────────────
 * Seeds the database so bot 8731737556 has its own rows in every
 * bot_id-scoped table. Settings are cloned from 8958935808.
 * Safe to re-run — uses INSERT IGNORE / ON DUPLICATE KEY UPDATE.
 *
 * Run: node seed_bot_8731737556.js
 */

import mysql from 'mysql2/promise';
import * as dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '.env') });

const NEW_BOT_ID  = '8731737556';
const OLD_BOT_ID  = '8958935808';  // Source for settings clone

const conn = await mysql.createConnection({
    host    : process.env.DB_HOST,
    port    : parseInt(process.env.DB_PORT || '3306', 10),
    user    : process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
    ssl     : { rejectUnauthorized: false },
});

console.log(`\n✅ Connected to DB: ${process.env.DB_NAME}\n`);

// ── 1. settings ──────────────────────────────────────────────────────────────
// Clone every setting from OLD_BOT_ID → NEW_BOT_ID.
// If a row already exists for NEW_BOT_ID it will NOT be overwritten.
console.log('📋 Seeding: settings');
try {
    const [existing] = await conn.execute(
        'SELECT setting_key FROM settings WHERE bot_id = ?', [NEW_BOT_ID]
    );
    const existingKeys = new Set(existing.map(r => r.setting_key));

    const [sourceRows] = await conn.execute(
        'SELECT setting_key, setting_value FROM settings WHERE bot_id = ?', [OLD_BOT_ID]
    );

    const defaultSettings = [
        ['rate_multiplier',  '55'],
        ['discount_percent', '0'],
        ['holiday_name',     ''],
        ['maintenance_mode', '0'],
        ['user_can_order',   '1'],
        ['marquee_text',     ''],
        ['top_services_ids', ''],
        ['admin_password',   process.env.ADMIN_PASSWORD || 'admin123'],
    ];

    // Merge: source DB rows first, then fill any gaps with defaults
    const toInsert = new Map();
    for (const [k, v] of defaultSettings) toInsert.set(k, v);
    for (const r of sourceRows) toInsert.set(r.setting_key, r.setting_value);  // source wins over defaults

    let inserted = 0;
    for (const [key, value] of toInsert) {
        if (existingKeys.has(key)) {
            console.log(`   ↩  settings.${key} already exists for ${NEW_BOT_ID}, skipping`);
            continue;
        }
        await conn.execute(
            'INSERT INTO settings (setting_key, bot_id, setting_value) VALUES (?, ?, ?)',
            [key, NEW_BOT_ID, value]
        );
        console.log(`   ✔  settings.${key} = "${value}"`);
        inserted++;
    }
    console.log(`   → ${inserted} rows inserted into settings\n`);
} catch (e) {
    console.error('   ❌ settings error:', e.message, '\n');
}

// ── 2. admin_users ────────────────────────────────────────────────────────────
console.log('📋 Seeding: admin_users');
try {
    await conn.execute(`
        CREATE TABLE IF NOT EXISTS admin_users (
            id INT AUTO_INCREMENT PRIMARY KEY,
            username VARCHAR(255) NOT NULL,
            password VARCHAR(255) NOT NULL,
            bot_id VARCHAR(50) NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE KEY username_bot_id (username, bot_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    const adminUser = process.env.ADMIN_USERNAME || 'admin';
    const adminPass = process.env.ADMIN_PASSWORD || 'admin123';

    await conn.execute(`
        INSERT INTO admin_users (username, password, bot_id)
        VALUES (?, ?, ?)
        ON DUPLICATE KEY UPDATE password = VALUES(password)
    `, [adminUser, adminPass, NEW_BOT_ID]);

    console.log(`   ✔  admin_users: user="${adminUser}" bot_id=${NEW_BOT_ID}\n`);
} catch (e) {
    console.error('   ❌ admin_users error:', e.message, '\n');
}

// ── 3. Verify bot_id columns exist in key tables ──────────────────────────────
// Tables like auth, orders, deposits, transactions already have bot_id columns
// (added by earlier migrations). We just confirm they exist.
const tablesToCheck = ['auth', 'orders', 'deposits', 'transactions', 'alerts',
                       'chat_messages', 'service_custom', 'broadcasts',
                       'broadcast_messages', 'withdrawals'];

console.log('🔍 Checking bot_id column exists in key tables:');
for (const table of tablesToCheck) {
    try {
        const [cols] = await conn.execute(
            `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
             WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = 'bot_id'`,
            [process.env.DB_NAME, table]
        );
        if (cols.length > 0) {
            // Count rows for new bot
            const [cnt] = await conn.execute(
                `SELECT COUNT(*) as c FROM \`${table}\` WHERE bot_id = ?`, [NEW_BOT_ID]
            );
            console.log(`   ✅  ${table} — has bot_id column (${cnt[0].c} rows for ${NEW_BOT_ID})`);
        } else {
            console.log(`   ⚠️  ${table} — NO bot_id column yet (will be added by runtime auto-migration)`);
        }
    } catch (e) {
        console.log(`   ⚠️  ${table} — table may not exist yet: ${e.message}`);
    }
}

// ── 4. Summary ───────────────────────────────────────────────────────────────
console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅  Done! Bot ${NEW_BOT_ID} is now seeded in the DB.

Next step: Make sure your server/.env BOT_TOKEN starts
with ${NEW_BOT_ID}: e.g. BOT_TOKEN=${NEW_BOT_ID}:AAH...
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`);

await conn.end();
process.exit(0);
