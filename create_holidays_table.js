import pool from './config/database.js';

async function run() {
    console.log('🚀 Running holidays table creation migration for Primora...');
    try {
        const conn = await pool.getConnection();
        await conn.execute(`
            CREATE TABLE IF NOT EXISTS holidays (
                id INT AUTO_INCREMENT PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                discount_percent INT DEFAULT 0,
                status VARCHAR(50) DEFAULT 'inactive',
                start_date DATE DEFAULT NULL,
                end_date DATE DEFAULT NULL,
                category VARCHAR(50) DEFAULT 'custom',
                is_recurring TINYINT DEFAULT 1,
                description TEXT
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        console.log('✅ holidays table created / verified successfully in Primora DB');
        conn.release();
    } catch (err) {
        console.error('❌ Migration failed:', err);
    } finally {
        process.exit(0);
    }
}

run();
