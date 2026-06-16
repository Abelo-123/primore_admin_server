import pool from './config/database.js';

async function check() {
    try {
        const [columns] = await pool.execute('SHOW COLUMNS FROM orders');
        console.log('Columns in orders:');
        console.log(columns.map(c => ({ Field: c.Field, Type: c.Type })));

        const [rows] = await pool.execute('SELECT * FROM orders ORDER BY id DESC LIMIT 5');
        console.log('Last 5 rows in orders:');
        console.log(rows);
    } catch (err) {
        console.error('Error listing columns:', err.message);
    }
    process.exit();
}
check();
