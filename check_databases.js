import mysql from 'mysql2/promise';
import 'dotenv/config';

async function run() {
    try {
        const conn = await mysql.createConnection({
            host: process.env.DB_HOST,
            user: process.env.DB_USER,
            password: process.env.DB_PASS,
            port: parseInt(process.env.DB_PORT || '3306', 10),
        });
        const [dbs] = await conn.execute('SHOW DATABASES');
        console.log('=== ALL DATABASES ===');
        console.table(dbs);

        for (const dbRow of dbs) {
            const dbName = dbRow.Database;
            if (dbName === 'information_schema' || dbName === 'performance_schema' || dbName === 'mysql' || dbName === 'sys') continue;
            try {
                await conn.changeUser({ database: dbName });
                const [sRows] = await conn.execute("SELECT setting_key, setting_value FROM settings WHERE setting_key IN ('discount_percent', 'holiday_name', 'marquee_text', 'rate_multiplier')");
                console.log(`=== SETTINGS IN DB "${dbName}" ===`);
                console.table(sRows);
            } catch (e) {
                console.log(`Could not query settings in DB "${dbName}":`, e.message);
            }
        }
        await conn.end();
    } catch (err) {
        console.error(err);
    } finally {
        process.exit(0);
    }
}

run();
