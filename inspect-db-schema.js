import pool from './config/database.js';

async function check() {
    try {
        const conn = await pool.getConnection();
        
        console.log('--- Inspecting settings table ---');
        try {
            const [columns] = await conn.execute('DESCRIBE settings');
            console.log(columns);
        } catch (e) {
            console.error('Error describing settings:', e.message);
        }

        console.log('--- Inspecting admin_withdrawals table ---');
        try {
            const [columns] = await conn.execute('DESCRIBE admin_withdrawals');
            console.log(columns);
        } catch (e) {
            console.error('Error describing admin_withdrawals:', e.message);
        }

        conn.release();
        process.exit(0);
    } catch (e) {
        console.error('Fatal connection error:', e.message);
        process.exit(1);
    }
}

check();
