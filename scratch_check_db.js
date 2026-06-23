import pool from './config/database.js';

async function check() {
    try {
        const [rows] = await pool.execute('SHOW CREATE TABLE auth');
        console.log('CREATE TABLE auth:');
        console.log(rows[0]['Create Table']);
    } catch (err) {
        console.error('Error:', err.message);
    }
    process.exit();
}
check();
