import pool from './config/database.js';

async function check() {
    try {
        const [rows] = await pool.execute('SELECT setting_key, setting_value FROM settings');
        console.log('=== SETTINGS ROWS ===');
        const settings = {};
        rows.forEach(r => { settings[r.setting_key] = r.setting_value; });
        console.log('settings object:', settings);

        const [activeHolidays] = await pool.execute("SELECT name, discount_percent FROM holidays WHERE status = 'active' ORDER BY id DESC LIMIT 1");
        console.log('=== ACTIVE HOLIDAYS QUERY RESULT ===');
        console.log(activeHolidays);
    } catch (err) {
        console.error(err);
    } finally {
        process.exit(0);
    }
}

check();
