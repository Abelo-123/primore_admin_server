/**
 * Get Services — Direct Fetch from GodOfPanel
 *
 * GET /api/services
 *
 * Refreshes data directly from godofpanel.com using GODOFPANEL_API_KEY
 * Applies 'rate_multiplier' from settings to convert USD -> ETB.
 */
import { Router } from 'express';
import pool from '../config/database.js';

const router = Router();

// In-memory cache to prevent spamming GodOfPanel
let cachedServices = null;
let lastCacheTime = 0;
const CACHE_TTL_MS = 60 * 1000; // 1 minute cache

router.get('/', async (req, res) => {
    const forceRefresh = req.query.refresh === '1';
    const reqCategory = req.query.category || null;
    const reqIds = req.query.ids ? req.query.ids.split(',').map(id => parseInt(id, 10)) : null;
    const includeDisabled = req.query.include_disabled === '1';
    const apiKey = process.env.GODOFPANEL_API_KEY;

    try {
        if (!apiKey) {
            return res.status(500).json({ error: 'GODOFPANEL_API_KEY not configured in backend .env' });
        }

        const now = Date.now();
        
        // Handle Top Services category from settings
        let topServiceIds = [];
        if (reqCategory === 'Top Services') {
            const [topServicesRow] = await pool.execute(
                'SELECT setting_value FROM settings WHERE setting_key = "top_services_ids"'
            );
            if (topServicesRow.length > 0 && topServicesRow[0].setting_value) {
                topServiceIds = topServicesRow[0].setting_value
                    .split(',')
                    .map(s => parseInt(s.trim(), 10))
                    .filter(n => !isNaN(n));
            }
        }

        if (!forceRefresh && cachedServices && (now - lastCacheTime) < CACHE_TTL_MS) {
            let result = cachedServices;
            
            if (reqCategory === 'Top Services' && topServiceIds.length > 0) {
                // Filter and reorder to match exact order from settings
                const serviceMap = new Map(result.map(s => [s.service, s]));
                result = topServiceIds
                    .map(id => serviceMap.get(id))
                    .filter(s => s !== undefined && s.is_enabled !== false && s.is_enabled !== 0);
            } else if (reqCategory) {
                result = result.filter(s => s.category === reqCategory);
            }
            if (reqIds) result = result.filter(s => reqIds.includes(s.service));
            return res.json(result);
        }

        // 1. Fetch raw services from GodOfPanel
        const response = await fetch(`https://godofpanel.com/api/v2?key=${apiKey}&action=services`);
        if (!response.ok) {
            throw new Error(`GodOfPanel returned ${response.status}`);
        }
        
        const rawServices = await response.json();
        
        if (!Array.isArray(rawServices)) {
            // GodOfPanel might return { error: "..." } if key is invalid
            if (rawServices.error) {
                console.error('[get_services] Provider Error:', rawServices.error);
                return res.status(502).json({ error: rawServices.error });
            }
            throw new Error('Invalid response format from provider');
        }

        // 2. Fetch rate multiplier from DB
        const [settingsRows] = await pool.execute(
            'SELECT setting_value FROM settings WHERE setting_key = "rate_multiplier"'
        );
        let rateMultiplier = 55.0;
        if (settingsRows.length > 0) {
            rateMultiplier = parseFloat(settingsRows[0].setting_value) || 55.0;
        }

        // 3. Fetch manual service adjustments and custom pricing from DB
        let adjustmentsMap = {};
        let customPricingMap = {};
        try {
            const [adjRows] = await pool.execute('SELECT service_id, average_time FROM service_adjustments');
            adjRows.forEach(row => {
                adjustmentsMap[row.service_id] = row.average_time;
            });
        } catch (dbErr) {
            console.log('[get_services] Note: service_adjustments table might be missing or empty.');
        }

        try {
            const [customRows] = await pool.execute('SELECT service_id, custom_rate, profit_margin, is_enabled, custom_description FROM service_custom');
            customRows.forEach(row => {
                customPricingMap[row.service_id] = {
                    custom_rate: row.custom_rate,
                    profit_margin: row.profit_margin,
                    is_enabled: row.is_enabled,
                    custom_description: row.custom_description
                };
            });
        } catch (dbErr) {
            console.log('[get_services] Note: service_custom table might be missing.');
        }

        // 4. Transform services
        const finalServices = rawServices.map(svc => {
            const numericRate = parseFloat(svc.rate) || 0;
            const baseRate = numericRate * rateMultiplier;
            const custom = customPricingMap[svc.service];
            
            let finalRate, isEnabled = true, profitMargin = 0;
            
            if (custom) {
                isEnabled = custom.is_enabled;
                if (custom.custom_rate !== null) {
                    finalRate = parseFloat(custom.custom_rate);
                } else if (custom.profit_margin > 0) {
                    finalRate = (baseRate * (1 + custom.profit_margin / 100)).toFixed(2);
                    profitMargin = custom.profit_margin;
                } else {
                    finalRate = baseRate.toFixed(2);
                }
            } else {
                finalRate = baseRate.toFixed(2);
            }
            
            return {
                service: parseInt(svc.service),
                name: svc.name,
                type: svc.type,
                category: svc.category,
                rate: finalRate,
                min: parseInt(svc.min),
                max: parseInt(svc.max),
                refill: svc.refill === true || svc.refill === 1 || svc.refill === '1',
                cancel: svc.cancel === true || svc.cancel === 1 || svc.cancel === '1',
                average_time: adjustmentsMap[svc.service] || 'Not specified',
                is_enabled: isEnabled,
                profit_margin: profitMargin,
                has_custom: !!custom,
                custom_description: custom ? custom.custom_description : null
            };
        });

        // Update Cache
        cachedServices = finalServices;
        lastCacheTime = now;
        
        // Filter result before sending
        let result = finalServices;
        
        if (reqCategory === 'Top Services' && topServiceIds.length > 0) {
            // Filter and reorder to match exact order from settings
            const serviceMap = new Map(result.map(s => [s.service, s]));
            result = topServiceIds
                .map(id => serviceMap.get(id))
                .filter(s => s !== undefined && s.is_enabled !== false && s.is_enabled !== 0);
        } else if (reqCategory) {
            result = result.filter(s => s.category === reqCategory);
        }
        if (reqIds) result = result.filter(s => reqIds.includes(s.service));

        // Filter out disabled services unless explicitly requested
        if (!includeDisabled) {
            result = result.filter(s => s.is_enabled !== false && s.is_enabled !== 0);
        }

        return res.json(result);
    } catch (err) {
        console.error('[get_services] Error:', err);
        
        // Fallback to cache if request fails but we have stale data
        if (cachedServices) {
            console.log('[get_services] Serving stale cache due to upstream error.');
            let result = cachedServices;
            
            if (reqCategory === 'Top Services' && topServiceIds.length > 0) {
                const serviceMap = new Map(result.map(s => [s.service, s]));
                result = topServiceIds
                    .map(id => serviceMap.get(id))
                    .filter(s => s !== undefined && s.is_enabled !== false && s.is_enabled !== 0);
            } else if (reqCategory) {
                result = result.filter(s => s.category === reqCategory);
            }
            if (reqIds) result = result.filter(s => reqIds.includes(s.service));
            if (!includeDisabled) {
                result = result.filter(s => s.is_enabled !== false && s.is_enabled !== 0);
            }
            return res.json(result);
        }

        return res.status(500).json({ error: 'Failed to fetch services from provider' });
    }
});

export default router;
