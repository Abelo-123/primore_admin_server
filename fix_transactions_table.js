/**
 * One-shot fix: ensures `transactions` table exists with bot_id and reference_id columns.
 * Run with: node fix_transactions_table.js
 */
import 'dotenv/config';
import pool from './config/database.js';

async function fix() {
    const conn = await pool.getConnection();
    try {
        console.log('--- Fixing transactions table ---');

        // Create table if missing
        await conn.execute(`
            CREATE TABLE IF NOT EXISTS transactions (
                id INT AUTO_INCREMENT PRIMARY KEY,
                user_id VARCHAR(255) NOT NULL,
                bot_id VARCHAR(255) DEFAULT NULL,
                type VARCHAR(50) NOT NULL,
                amount DECIMAL(10, 2) NOT NULL,
                balance_after DECIMAL(10, 2) NOT NULL,
                reference_type VARCHAR(50),
                reference_id INT,
                description TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `);
        console.log('✅ transactions table exists');

        // Add bot_id column if missing
        try {
            await conn.execute('ALTER TABLE transactions ADD COLUMN bot_id VARCHAR(255) DEFAULT NULL AFTER user_id');
            console.log('✅ Added bot_id column');
        } catch (e) {
            console.log('ℹ️  bot_id already exists or error:', e.message);
        }

        // Add reference_id column if missing
        try {
            await conn.execute('ALTER TABLE transactions ADD COLUMN reference_id INT DEFAULT NULL');
            console.log('✅ Added reference_id column');
        } catch (e) {
            console.log('ℹ️  reference_id already exists or error:', e.message);
        }

        // Add reference_type column if missing
        try {
            await conn.execute('ALTER TABLE transactions ADD COLUMN reference_type VARCHAR(50) DEFAULT NULL');
            console.log('✅ Added reference_type column');
        } catch (e) {
            console.log('ℹ️  reference_type already exists or error:', e.message);
        }

        // Show final schema
        const [cols] = await conn.execute('DESCRIBE transactions');
        console.log('\n--- transactions table schema ---');
        cols.forEach(c => console.log(` ${c.Field} (${c.Type})`));

        console.log('\n✅ Done! transactions table is ready.');
    } finally {
        conn.release();
        await pool.end();
    }
}

fix().catch(err => {
    console.error('❌ Fix failed:', err.message);
    process.exit(1);
});
