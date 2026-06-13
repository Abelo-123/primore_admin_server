<?php
/**
 * Services and Categories Route Handler
 */

require_once __DIR__ . '/../config.php';

// Define platforms keywords
$platformKeywords = [
    'instagram' => ['instagram', 'ig '],
    'tiktok'    => ['tiktok', 'tik tok'],
    'youtube'   => ['youtube', 'yt '],
    'facebook'  => ['facebook', 'fb '],
    'twitter'   => ['twitter', 'x.com', 'tweet'],
    'telegram'  => ['telegram', 'tg '],
];

function determinePlatform($category) {
    global $platformKeywords;
    if (empty($category)) return 'other';
    $lower = strtolower($category);
    foreach ($platformKeywords as $platform => $keywords) {
        foreach ($keywords as $kw) {
            if (strpos($lower, $kw) !== false) {
                return $platform;
            }
        }
    }
    return 'other';
}

// Local Cache Helpers
$cacheDir = __DIR__ . '/../cache';
if (!file_exists($cacheDir)) {
    mkdir($cacheDir, 0755, true);
}

function getCachedData($key, $ttl = 60) { // 1 minute default cache to align with Node app
    global $cacheDir;
    $cacheFile = "{$cacheDir}/cache_{$key}.json";
    if (file_exists($cacheFile)) {
        $data = json_decode(file_get_contents($cacheFile), true);
        if ($data && isset($data['time']) && (time() - $data['time']) < $ttl) {
            return $data['payload'];
        }
    }
    return null;
}

function setCachedData($key, $payload) {
    global $cacheDir;
    $cacheFile = "{$cacheDir}/cache_{$key}.json";
    $data = [
        'time' => time(),
        'payload' => $payload
    ];
    file_put_contents($cacheFile, json_encode($data));
}

// Upstream GodOfPanel fetch helper
function fetchUpstreamServices() {
    global $gopApiKey;
    if (empty($gopApiKey)) {
        throw new Exception('GODOFPANEL_API_KEY not configured in backend environment');
    }
    
    $lastError = 'Unknown error';
    for ($i = 0; $i < 3; $i++) {
        $res = curlRequest('POST', 'https://godofpanel.com/api/v2', [], [
            'key' => $gopApiKey,
            'action' => 'services'
        ], 30);
        
        if ($res['code'] === 200 && !empty($res['body'])) {
            $data = json_decode($res['body'], true);
            if (is_array($data)) {
                return $data;
            } elseif (is_array($data) && isset($data['error'])) {
                $lastError = $data['error'];
            }
        } else {
            $lastError = !empty($res['error']) ? $res['error'] : "HTTP Code {$res['code']}";
        }
        usleep(1500000); // Sleep 1.5s
    }
    
    throw new Exception($lastError);
}

// ─── ROUTE: /categories (GET) ──────────────────────────────────────────────
if ($route === '/categories') {
    try {
        $forceRefresh = isset($requestData['refresh']) && $requestData['refresh'] === '1';
        $platform = isset($requestData['platform']) ? $requestData['platform'] : null;
        
        $disabledServiceIds = [];
        try {
            $stmt = $pdo->query('SELECT service_id FROM service_custom WHERE is_enabled = 0');
            $disabledRows = $stmt->fetchAll();
            foreach ($disabledRows as $row) {
                $disabledServiceIds[] = (int)$row['service_id'];
            }
        } catch (Exception $e) {}

        // Fetch from cache or upstream API (TTL 300s)
        $rawServices = null;
        if (!$forceRefresh) {
            $rawServices = getCachedData('upstream_services', 300);
        }
        
        if (!$rawServices) {
            try {
                $rawServices = fetchUpstreamServices();
                setCachedData('upstream_services', $rawServices);
            } catch (Exception $e) {
                $rawServices = getCachedData('upstream_services', 86400 * 365);
                if (!$rawServices) {
                    throw $e;
                }
            }
        }
        
        $categoriesSet = [];
        foreach ($rawServices as $svc) {
            $svcId = (int)$svc['service'];
            if (in_array($svcId, $disabledServiceIds)) {
                continue;
            }
            if (!empty($svc['category'])) {
                $categoriesSet[] = $svc['category'];
            }
        }
        
        $allCategories = array_values(array_unique($categoriesSet));
        
        $result = $allCategories;
        if (!empty($platform) && $platform !== 'top') {
            if ($platform === 'other') {
                $allMajorKeywords = [];
                foreach ($platformKeywords as $kwList) {
                    $allMajorKeywords = array_merge($allMajorKeywords, $kwList);
                }
                
                $result = array_filter($allCategories, function($cat) use ($allMajorKeywords) {
                    $lowerCat = strtolower($cat);
                    foreach ($allMajorKeywords as $kw) {
                        if (strpos($lowerCat, $kw) !== false) {
                            return false;
                        }
                    }
                    return true;
                });
            } else {
                $keywords = isset($platformKeywords[$platform]) ? $platformKeywords[$platform] : null;
                if ($keywords) {
                    $result = array_filter($allCategories, function($cat) use ($keywords) {
                        $lowerCat = strtolower($cat);
                        foreach ($keywords as $kw) {
                            if (strpos($lowerCat, $kw) !== false) {
                                return true;
                            }
                        }
                        return false;
                    });
                }
            }
            $result = array_values($result);
        }
        
        // Ensure not empty
        if (!$result || count($result) === 0) {
            $result = ['Instagram Followers', 'Instagram Likes', 'TikTok Followers', 'YouTube Views', 'Facebook Followers', 'Twitter Followers'];
        }

        echo json_encode([
            'success' => true,
            'categories' => $result,
            'total' => count($result),
            'cached' => !$forceRefresh
        ]);
        
    } catch (Exception $e) {
        $staleCache = getCachedData('upstream_services', 86400 * 365);
        if ($staleCache) {
            $categoriesSet = [];
            foreach ($staleCache as $svc) {
                if (!empty($svc['category'])) {
                    $categoriesSet[] = $svc['category'];
                }
            }
            $result = array_values(array_unique($categoriesSet));
            echo json_encode([
                'success' => true,
                'categories' => $result,
                'total' => count($result),
                'cached' => true,
                'stale' => true
            ]);
        } else {
            http_response_code(500);
            echo json_encode(['error' => 'Failed to fetch categories: ' . $e->getMessage()]);
        }
    }
    exit;
}

// ─── ROUTE: /services (GET) ────────────────────────────────────────────────
if ($route === '/services') {
    try {
        $forceRefresh = isset($requestData['refresh']) && $requestData['refresh'] === '1';
        $reqCategory = isset($requestData['category']) ? $requestData['category'] : null;
        $includeDisabled = isset($requestData['include_disabled']) && $requestData['include_disabled'] === '1';
        
        $reqIds = null;
        if (!empty($requestData['ids'])) {
            $reqIds = array_map('intval', explode(',', $requestData['ids']));
        }
        
        // 1. Get database configs
        $rateMultiplier = 55.0;
        try {
            $stmt = $pdo->query("SELECT setting_value FROM settings WHERE setting_key = 'rate_multiplier'");
            $row = $stmt->fetch();
            if ($row) $rateMultiplier = (float)$row['setting_value'] ?: 55.0;
        } catch (Exception $e) {}

        // Custom pricing map
        $customPricingMap = [];
        try {
            $stmt = $pdo->query('SELECT service_id, custom_rate, profit_margin, is_enabled, custom_description FROM service_custom');
            $customRows = $stmt->fetchAll();
            foreach ($customRows as $row) {
                $customPricingMap[(int)$row['service_id']] = [
                    'custom_rate' => $row['custom_rate'] !== null ? (float)$row['custom_rate'] : null,
                    'profit_margin' => (float)$row['profit_margin'],
                    'is_enabled' => (int)$row['is_enabled'],
                    'custom_description' => $row['custom_description']
                ];
            }
        } catch (Exception $e) {}

        // Service delivery duration adjustments map
        $adjustmentsMap = [];
        try {
            $stmt = $pdo->query('SELECT service_id, average_time FROM service_adjustments');
            $adjRows = $stmt->fetchAll();
            foreach ($adjRows as $row) {
                $adjustmentsMap[(int)$row['service_id']] = $row['average_time'];
            }
        } catch (Exception $e) {}

        // Fetch Raw Services
        $rawServices = null;
        if (!$forceRefresh) {
            $rawServices = getCachedData('upstream_services', 60); // 1 minute TTL to align with Node server
        }
        if (!$rawServices) {
            try {
                $rawServices = fetchUpstreamServices();
                setCachedData('upstream_services', $rawServices);
            } catch (Exception $ex) {
                $rawServices = getCachedData('upstream_services', 86400 * 365);
                if (!$rawServices) {
                    throw $ex;
                }
            }
        }

        // 2. Centralized formatter
        $processed = [];
        foreach ($rawServices as $svc) {
            $svcId = (int)$svc['service'];
            $custom = isset($customPricingMap[$svcId]) ? $customPricingMap[$svcId] : null;
            
            $isEnabled = $custom ? ($custom['is_enabled'] !== 0) : true;
            if (!$isEnabled && !$includeDisabled) {
                continue;
            }
            
            $numericRate = (float)$svc['rate'];
            $baseRate = $numericRate * $rateMultiplier;
            
            $finalRate = $baseRate;
            $profitMargin = 0;
            if ($custom) {
                if ($custom['custom_rate'] !== null) {
                    $finalRate = $custom['custom_rate'];
                } elseif ($custom['profit_margin'] > 0) {
                    $finalRate = $baseRate * (1 + $custom['profit_margin'] / 100);
                    $profitMargin = (float)$custom['profit_margin'];
                }
            }
            
            $processed[] = [
                'service'            => $svcId,
                'name'               => $svc['name'],
                'type'               => $svc['type'],
                'category'           => $svc['category'],
                'rate'               => number_format($finalRate, 2, '.', ''),
                'original_rate'      => $numericRate,
                'min'                => (int)$svc['min'],
                'max'                => (int)$svc['max'],
                'refill'             => ($svc['refill'] === true || $svc['refill'] == 1 || $svc['refill'] === '1'),
                'cancel'             => ($svc['cancel'] === true || $svc['cancel'] == 1 || $svc['cancel'] === '1'),
                'average_time'       => isset($adjustmentsMap[$svcId]) ? $adjustmentsMap[$svcId] : (isset($svc['average_time']) ? $svc['average_time'] : 'Not specified'),
                'platform_id'        => determinePlatform($svc['category']),
                'is_enabled'         => (bool)$isEnabled,
                'profit_margin'      => $profitMargin,
                'has_custom'         => $custom !== null,
                'custom_description' => $custom ? $custom['custom_description'] : null
            ];
        }

        // 3. Filter final response
        if ($reqCategory === 'Top Services') {
            $topServicesIdsStr = '';
            try {
                $stmt = $pdo->query("SELECT setting_value FROM settings WHERE setting_key = 'top_services_ids'");
                $row = $stmt->fetch();
                if ($row) $topServicesIdsStr = $row['setting_value'] ?: '';
            } catch (Exception $e) {}
            
            $recommendedIds = array_filter(array_map('intval', explode(',', $topServicesIdsStr)));
            
            // Filter and sort exact order
            $serviceMap = [];
            foreach ($processed as $s) {
                $serviceMap[$s['service']] = $s;
            }
            $temp = [];
            foreach ($recommendedIds as $id) {
                if (isset($serviceMap[$id])) {
                    $temp[] = $serviceMap[$id];
                }
            }
            $processed = $temp;
        } elseif (!empty($reqCategory)) {
            $processed = array_values(array_filter($processed, function($s) use ($reqCategory) {
                return $s['category'] === $reqCategory;
            }));
        }

        if ($reqIds) {
            $processed = array_values(array_filter($processed, function($s) use ($reqIds) {
                return in_array($s['service'], $reqIds);
            }));
        }

        echo json_encode($processed);

    } catch (Exception $e) {
        http_response_code(500);
        echo json_encode(['error' => 'Failed to fetch services: ' . $e->getMessage()]);
    }
    exit;
}
