/**
 * Get Categories — Direct Fetch from GodOfPanel API
 *
 * GET /api/categories
 * GET /api/categories?platform=instagram
 *
 * Fetches raw service list from godofpanel.com, extracts unique categories.
 * Optionally filters by platform keyword if ?platform= is provided.
 */
import { Router } from 'express';

const router = Router();

// In-memory cache
let cachedCategories = null;
let lastCacheTime = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// Platform keyword mapping (mirrors frontend PLATFORMS constant)
const PLATFORM_KEYWORDS = {
    instagram: ['instagram', 'ig '],
    tiktok: ['tiktok', 'tik tok'],
    youtube: ['youtube', 'yt '],
    facebook: ['facebook', 'fb '],
    twitter: ['twitter', 'x.com', 'tweet'],
    telegram: ['telegram', 'tg '],
};

router.get('/', async (req, res) => {
    try {
        const forceRefresh = req.query.refresh === '1';
        const platform = req.query.platform || null;
        const apiKey = process.env.GODOFPANEL_API_KEY;

        if (!apiKey) {
            return res.status(500).json({ error: 'GODOFPANEL_API_KEY not configured' });
        }

        const now = Date.now();
        let allCategories = cachedCategories;

        // Fetch fresh data if cache expired or force refresh
        if (forceRefresh || !allCategories || (now - lastCacheTime) > CACHE_TTL_MS) {
            console.log('[get_categories] Fetching fresh categories from GodOfPanel...');
            
            const response = await fetch(
                `https://godofpanel.com/api/v2?key=${apiKey}&action=services`
            );

            if (!response.ok) {
                throw new Error(`GodOfPanel returned ${response.status}`);
            }

            const rawServices = await response.json();

            if (!Array.isArray(rawServices)) {
                if (rawServices.error) {
                    console.error('[get_categories] Provider Error:', rawServices.error);
                    return res.status(502).json({ error: rawServices.error });
                }
                throw new Error('Invalid response format from provider');
            }

            // Extract unique category names
            allCategories = [...new Set(
                rawServices
                    .map(svc => svc.category)
                    .filter(Boolean)
            )];

            // Update cache
            cachedCategories = allCategories;
            lastCacheTime = now;
            
            console.log(`[get_categories] Cached ${allCategories.length} unique categories`);
        }

        // Filter by platform if requested
        let result = allCategories;
        if (platform && platform !== 'top') {
            const keywords = PLATFORM_KEYWORDS[platform];
            
            if (platform === 'other') {
                // "Other" = everything NOT matching any major platform
                const allMajorKeywords = Object.values(PLATFORM_KEYWORDS).flat();
                result = allCategories.filter(cat => {
                    const lower = cat.toLowerCase();
                    return !allMajorKeywords.some(kw => lower.includes(kw));
                });
            } else if (keywords) {
                result = allCategories.filter(cat => {
                    const lower = cat.toLowerCase();
                    return keywords.some(kw => lower.includes(kw));
                });
            }
        }

        // Ensure always returns array (never empty, return default)
        if (!result || !Array.isArray(result) || result.length === 0) {
            result = ['Instagram Followers', 'Instagram Likes', 'TikTok Followers', 'YouTube Views', 'Facebook Followers', 'Twitter Followers'];
        }

        return res.json({
            success: true,
            categories: result,
            total: result.length,
            cached: (now - lastCacheTime) < 1000 ? false : true,
        });
    } catch (err) {
        console.error('[get_categories] Error:', err);

        // Fallback to stale cache
        if (cachedCategories) {
            console.log('[get_categories] Serving stale cache due to upstream error.');
            return res.json({
                success: true,
                categories: cachedCategories,
                total: cachedCategories.length,
                cached: true,
                stale: true,
            });
        }

        return res.status(500).json({ error: 'Failed to fetch categories from provider' });
    }
});

export default router;
