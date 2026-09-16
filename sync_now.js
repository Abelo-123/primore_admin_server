import pool from './config/database.js';

async function sync() {
    try {
        const [activeRows] = await pool.execute(
            "SELECT name, discount_percent FROM holidays WHERE status = 'active' ORDER BY id DESC LIMIT 1"
        );
        if (activeRows.length > 0) {
            const hName = activeRows[0].name || '';
            const hDisc = String(activeRows[0].discount_percent || 0);
            await pool.execute(
                "INSERT INTO settings (setting_key, setting_value) VALUES ('holiday_name', ?) ON DUPLICATE KEY UPDATE setting_value = ?",
                [hName, hName]
            );
            await pool.execute(
                "INSERT INTO settings (setting_key, setting_value) VALUES ('discount_percent', ?) ON DUPLICATE KEY UPDATE setting_value = ?",
                [hDisc, hDisc]
            );
            console.log(`✅ Synced active holiday "${hName}" with ${hDisc}% discount to settings table!`);
        } else {
            await pool.execute(
                "INSERT INTO settings (setting_key, setting_value) VALUES ('holiday_name', '') ON DUPLICATE KEY UPDATE setting_value = ''"
            );
            await pool.execute(
                "INSERT INTO settings (setting_key, setting_value) VALUES ('discount_percent', '0') ON DUPLICATE KEY UPDATE setting_value = '0'"
            );
            console.log('ℹ️ No active holiday found. Cleared holiday settings.');
        }

        const [settings] = await pool.execute("SELECT * FROM settings WHERE setting_key IN ('holiday_name', 'discount_percent')");
        console.log('=== VERIFIED SETTINGS ===');
        console.table(settings);
    } catch (err) {
        console.error(err);
    } finally {
        process.exit(0);
    }
}

sync();
