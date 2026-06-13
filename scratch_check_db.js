import pool from './config/database.js';

async function check() {
    try {
        const [columns] = await pool.execute('SHOW COLUMNS FROM service_custom');
        console.log('Columns in service_custom:');
        console.log(columns.map(c => ({ Field: c.Field, Type: c.Type, Null: c.Null })));
    } catch (err) {
        console.error('Error listing columns:', err.message);
    }
    process.exit();
}
check();
