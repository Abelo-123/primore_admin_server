import pool from './config/database.js';

async function check() {
    try {
        const [rows] = await pool.execute('SHOW INDEX FROM auth');
        console.log('INDEXES ON auth:');
        console.log(rows.map(r => ({ Table: r.Table, Non_unique: r.Non_unique, Key_name: r.Key_name, Column_name: r.Column_name })));
    } catch (err) {
        console.error('Error:', err.message);
    }
    process.exit();
}
check();
