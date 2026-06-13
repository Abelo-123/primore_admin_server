import 'dotenv/config';
import pool from './config/database.js';

async function migrate() {
    console.log('--- Starting Database Migration & Optimization ---');

    try {
        const conn = await pool.getConnection();

        console.log('Checking database connection... OK');

        // 1. Ensure `auth` table exists and is optimized
        const createAuth = `
        CREATE TABLE IF NOT EXISTS auth (
            id INT AUTO_INCREMENT PRIMARY KEY,
            tg_id VARCHAR(255) NOT NULL,
            balance DECIMAL(10, 2) DEFAULT 0.00,
            auth_provider VARCHAR(50) DEFAULT 'telegram',
            role VARCHAR(50) DEFAULT 'user',
            last_login DATETIME,
            email VARCHAR(255),
            first_name VARCHAR(255),
            last_name VARCHAR(255),
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            last_deposit DATETIME,
            last_order DATETIME,
            total_spent DECIMAL(10, 2) DEFAULT 0.00,
            UNIQUE KEY (tg_id)
        )`;
        await conn.execute(createAuth);
        console.log('Auth table checked/created.');

        // Add new columns to auth table if they don't exist
        try {
            await conn.execute('ALTER TABLE auth ADD COLUMN created_at DATETIME DEFAULT CURRENT_TIMESTAMP AFTER last_name');
        } catch (e) {}
        try {
            await conn.execute('ALTER TABLE auth ADD COLUMN last_deposit DATETIME AFTER created_at');
        } catch (e) {}
        try {
            await conn.execute('ALTER TABLE auth ADD COLUMN last_order DATETIME AFTER last_deposit');
        } catch (e) {}
        try {
            await conn.execute('ALTER TABLE auth ADD COLUMN total_spent DECIMAL(10, 2) DEFAULT 0.00 AFTER last_order');
        } catch (e) {}

        // Add indexes for the new columns
        try {
            await conn.execute('CREATE INDEX idx_auth_last_deposit ON auth(last_deposit)');
        } catch (e) {}
        try {
            await conn.execute('CREATE INDEX idx_auth_last_order ON auth(last_order)');
        } catch (e) {}
        try {
            await conn.execute('CREATE INDEX idx_auth_created_at ON auth(created_at)');
        } catch (e) {}

        // 2. Ensure `deposits` table exists and is optimized
        const createDeposits = `
        CREATE TABLE IF NOT EXISTS deposits (
            id INT AUTO_INCREMENT PRIMARY KEY,
            user_id VARCHAR(255) NOT NULL,
            amount DECIMAL(10, 2) NOT NULL,
            tx_ref VARCHAR(255) NOT NULL UNIQUE,
            status VARCHAR(50) DEFAULT 'pending',
            checkout_url TEXT,
            chapa_tx_ref VARCHAR(255),
            chapa_response TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            completed_at DATETIME
        )`;
        await conn.execute(createDeposits);
        
        try {
            await conn.execute('CREATE INDEX idx_deposits_user_id ON deposits(user_id)');
            console.log('Added INDEX to deposits(user_id)');
        } catch (e) {
            // Index might already exist
        }

        // 3. Ensure `orders` table exists and is optimized
        const createOrders = `
        CREATE TABLE IF NOT EXISTS orders (
            id INT AUTO_INCREMENT PRIMARY KEY,
            user_id VARCHAR(255) NOT NULL,
            service_id INT NOT NULL,
            target_link TEXT NOT NULL,
            quantity INT NOT NULL,
            provider_order_id VARCHAR(255),
            cost DECIMAL(10, 2) NOT NULL,
            status VARCHAR(50) DEFAULT 'pending',
            start_count INT DEFAULT 0,
            remains INT DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`;
        await conn.execute(createOrders);

        try {
            await conn.execute('CREATE INDEX idx_orders_user_id ON orders(user_id)');
            console.log('Added INDEX to orders(user_id)');
        } catch (e) {}

        // 4. Ensure `transactions` table
        const createTx = `
        CREATE TABLE IF NOT EXISTS transactions (
            id INT AUTO_INCREMENT PRIMARY KEY,
            user_id VARCHAR(255) NOT NULL,
            type VARCHAR(50) NOT NULL,
            amount DECIMAL(10, 2) NOT NULL,
            balance_after DECIMAL(10, 2) NOT NULL,
            reference_type VARCHAR(50),
            reference_id INT,
            description TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`;
        await conn.execute(createTx);

        try {
            await conn.execute('CREATE INDEX idx_transactions_user_id ON transactions(user_id)');
            console.log('Added INDEX to transactions(user_id)');
        } catch (e) {}

        // 5. Ensure `settings` table
        const createSettings = `
        CREATE TABLE IF NOT EXISTS settings (
            setting_key VARCHAR(100) PRIMARY KEY,
            setting_value TEXT
        )`;
        await conn.execute(createSettings);

        // Pre-fill some default settings if empty
        const [settingsCheck] = await conn.execute('SELECT COUNT(*) as c FROM settings');
        if (settingsCheck[0].c === 0) {
            await conn.execute('INSERT IGNORE INTO settings (setting_key, setting_value) VALUES ("rate_multiplier", "55.0")');
            await conn.execute('INSERT IGNORE INTO settings (setting_key, setting_value) VALUES ("discount_percent", "0")');
            console.log('Pre-filled settings table');
        }

        // 6. Ensure `chat_messages` table
        const createChat = `
        CREATE TABLE IF NOT EXISTS chat_messages (
            id INT AUTO_INCREMENT PRIMARY KEY,
            user_id VARCHAR(255) NOT NULL,
            message TEXT NOT NULL,
            is_admin BOOLEAN DEFAULT FALSE,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`;
        await conn.execute(createChat);

        try {
            await conn.execute('CREATE INDEX idx_chat_user_id ON chat_messages(user_id)');
            console.log('Added INDEX to chat_messages(user_id)');
        } catch (e) {}

        // 7. Ensure `alerts` table
        const createAlerts = `
        CREATE TABLE IF NOT EXISTS alerts (
            id INT AUTO_INCREMENT PRIMARY KEY,
            user_id VARCHAR(255) NOT NULL,
            title VARCHAR(255) NOT NULL,
            message TEXT NOT NULL,
            type VARCHAR(50) DEFAULT 'info',
            is_read BOOLEAN DEFAULT FALSE,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`;
        await conn.execute(createAlerts);

        try {
            await conn.execute('CREATE INDEX idx_alerts_user_id ON alerts(user_id)');
            console.log('Added INDEX to alerts(user_id)');
        } catch (e) {}
        
        // 8. Ensure `recommended_services` table
        const createRec = `
        CREATE TABLE IF NOT EXISTS recommended_services (
            id INT AUTO_INCREMENT PRIMARY KEY,
            service_id INT NOT NULL UNIQUE
        )`;
        await conn.execute(createRec);

        // 9. Ensure `service_custom` table for custom pricing
        const createServiceCustom = `
        CREATE TABLE IF NOT EXISTS service_custom (
            id INT AUTO_INCREMENT PRIMARY KEY,
            service_id INT NOT NULL UNIQUE,
            custom_rate DECIMAL(10, 2),
            profit_margin DECIMAL(5, 2) DEFAULT 0,
            is_enabled BOOLEAN DEFAULT TRUE,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        )`;
        await conn.execute(createServiceCustom);

        try {
            await conn.execute('ALTER TABLE service_custom ADD COLUMN updated_by VARCHAR(255) AFTER updated_at');
        } catch (e) {}

        try {
            await conn.execute('ALTER TABLE service_custom ADD COLUMN custom_description TEXT AFTER updated_by');
            console.log('Added custom_description column to service_custom table');
        } catch (e) {}

        try {
            await conn.execute('CREATE INDEX idx_service_custom_id ON service_custom(service_id)');
            console.log('Added INDEX to service_custom(service_id)');
        } catch (e) {}

        conn.release();
        console.log('--- Migration & Optimization Complete! ---');
        process.exit(0);
    } catch (err) {
        console.error('Migration Failed:', err);
        process.exit(1);
    }
}

migrate();
