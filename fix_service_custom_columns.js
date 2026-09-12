import pool from './config/database.js';

async function run() {
    console.log('🚀 Running service_custom columns fix migration for Primora...');
    try {
        const conn = await pool.getConnection();

        // 1. Add updated_at column if not exists
        try {
            await conn.execute('ALTER TABLE service_custom ADD COLUMN updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP');
            console.log('✅ Added updated_at column to service_custom table');
        } catch (err) {
            if (err.code === 'ER_DUP_FIELDNAME' || err.message.includes('Duplicate column')) {
                console.log('ℹ️ Column updated_at already exists');
            } else {
                console.error('⚠️ Could not add updated_at:', err.message);
            }
        }

        // 2. Add updated_by column if not exists
        try {
            await conn.execute('ALTER TABLE service_custom ADD COLUMN updated_by VARCHAR(255) DEFAULT NULL');
            console.log('✅ Added updated_by column to service_custom table');
        } catch (err) {
            if (err.code === 'ER_DUP_FIELDNAME' || err.message.includes('Duplicate column')) {
                console.log('ℹ️ Column updated_by already exists');
            } else {
                console.error('⚠️ Could not add updated_by:', err.message);
            }
        }

        // 3. Add custom_description column if not exists
        try {
            await conn.execute('ALTER TABLE service_custom ADD COLUMN custom_description TEXT');
            console.log('✅ Added custom_description column to service_custom table');
        } catch (err) {
            if (err.code === 'ER_DUP_FIELDNAME' || err.message.includes('Duplicate column')) {
                console.log('ℹ️ Column custom_description already exists');
            } else {
                console.error('⚠️ Could not add custom_description:', err.message);
            }
        }

        conn.release();
        console.log('✅ Migration completed successfully!');
    } catch (err) {
        console.error('❌ Migration script failed:', err);
    } finally {
        process.exit(0);
    }
}

run();
