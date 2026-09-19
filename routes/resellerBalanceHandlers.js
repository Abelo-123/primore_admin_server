function registerResellerBalanceRoutes(router, pool) {
  if (!router || !pool) {
    throw new Error('registerResellerBalanceRoutes requires router and pool');
  }

  router.get('/reseller/list-balances', async (req, res) => {
    const PRIMARY_RESELLER_ID = String(process.env.RESELLER_ID || 'primore').toLowerCase();

    const parsedCacheTtl = parseInt(process.env.RESELLER_CACHE_TTL || '300', 10);
    const CACHE_TTL = Number.isFinite(parsedCacheTtl) ? parsedCacheTtl : 300;

    const parsedRateLimitBackoff = parseInt(process.env.RESELLER_RATE_LIMIT_BACKOFF || '300', 10);
    const RATE_LIMIT_BACKOFF = Number.isFinite(parsedRateLimitBackoff) ? parsedRateLimitBackoff : 300;

    const toMoney = (value) => {
      const parsed = parseFloat(value);
      return Number.isFinite(parsed) ? Number(parsed.toFixed(2)) : 0;
    };

    const resellers = [
      {
        id: PRIMARY_RESELLER_ID,
        name: 'Primora Admin',
        url: process.env.PRIMORE_SERVER_URL || 'https://promre-back.onrender.com',
        apiKey: process.env.PRIMORE_API_KEY || process.env.GODOFPANEL_API_KEY || '',
        statusUrl: process.env.PRIMORE_STATUS_URL || 'https://promre-back.onrender.com/api/admin/reseller/status'
      }
    ];

    let localSettings = {};

    try {
      const [rows] = await pool.execute(
        "SELECT setting_key, setting_value FROM settings WHERE setting_key LIKE 'reseller_%' OR setting_key = 'total_deposit'"
      );

      rows.forEach((r) => {
        localSettings[r.setting_key] = r.setting_value;
      });
    } catch (e) {}

    const results = [];

    for (const reseller of resellers) {
      const resellerId = String(reseller.id || PRIMARY_RESELLER_ID).toLowerCase();
      const cacheKeyBalance = `reseller_balance_${resellerId}`;
      const cacheKeyDeposit = `reseller_total_deposit_${resellerId}`;
      const cacheKeyTs = `reseller_cache_ts_${resellerId}`;

      let rawCachedBalance = localSettings[cacheKeyBalance];

      if (rawCachedBalance === undefined && resellerId === PRIMARY_RESELLER_ID && localSettings['reseller_balance_primore'] !== undefined) {
        rawCachedBalance = localSettings['reseller_balance_primore'];
      }

      if (rawCachedBalance === undefined && localSettings['reseller_balance'] !== undefined) {
        rawCachedBalance = localSettings['reseller_balance'];
      }

      let rawCachedDeposit = localSettings[cacheKeyDeposit];

      if (rawCachedDeposit === undefined && resellerId === PRIMARY_RESELLER_ID && localSettings['reseller_total_deposit_primore'] !== undefined) {
        rawCachedDeposit = localSettings['reseller_total_deposit_primore'];
      }

      if (rawCachedDeposit === undefined && resellerId === PRIMARY_RESELLER_ID && localSettings['total_deposit'] !== undefined) {
        rawCachedDeposit = localSettings['total_deposit'];
      }

      if (rawCachedDeposit === undefined && localSettings['reseller_total_deposit'] !== undefined) {
        rawCachedDeposit = localSettings['reseller_total_deposit'];
      }

      const rawCachedTs = localSettings[cacheKeyTs];

      const parsedCachedBalance = rawCachedBalance !== undefined ? parseFloat(rawCachedBalance) : NaN;
      const parsedCachedDeposit = rawCachedDeposit !== undefined ? parseFloat(rawCachedDeposit) : NaN;
      const parsedCachedTs = rawCachedTs !== undefined ? parseInt(rawCachedTs, 10) : 0;

      const cachedBalance = Number.isFinite(parsedCachedBalance) ? parsedCachedBalance : undefined;
      const cachedDeposit = Number.isFinite(parsedCachedDeposit) ? parsedCachedDeposit : undefined;
      const cachedTs = Number.isFinite(parsedCachedTs) ? parsedCachedTs : 0;

      const nowSec = Math.floor(Date.now() / 1000);
      const backoffActive = cachedTs > nowSec;
      const cacheValid = !backoffActive && cachedBalance !== undefined && (nowSec - cachedTs) < CACHE_TTL;

      const buildResult = (balance, deposit, extra) => {
        const normalizedBalance = toMoney(balance);
        const normalizedDeposit = toMoney(deposit);

        return {
          id: resellerId,
          name: reseller.name,
          reseller_balance: normalizedBalance,
          total_deposit: normalizedDeposit,
          reseller_balance_primore: normalizedBalance,
          reseller_total_deposit_primore: normalizedDeposit,
          reseller_total_deposit: normalizedDeposit,
          balance: normalizedBalance,
          deposit: normalizedDeposit,
          online: false,
          ...extra
        };
      };

      if (backoffActive) {
        results.push(buildResult(
          cachedBalance !== undefined ? cachedBalance : 0,
          cachedDeposit !== undefined ? cachedDeposit : 0,
          {
            online: cachedBalance !== undefined,
            notice: cachedBalance !== undefined ? 'Rate Limited (Using Cached Balance)' : 'Rate Limited (Backoff)',
            health: 'degraded'
          }
        ));
        continue;
      }

      if (cacheValid) {
        results.push(buildResult(
          cachedBalance,
          cachedDeposit !== undefined ? cachedDeposit : 0,
          {
            online: true,
            notice: 'Cached'
          }
        ));
        continue;
      }

      let fetchSuccess = false;
      let fetchedBalance = cachedBalance !== undefined ? cachedBalance : 0;
      let fetchedDeposit = cachedDeposit !== undefined ? cachedDeposit : 0;
      let remoteBalanceFound = false;
      let remoteDepositFound = false;
      let errorMsg = '';

      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 15000);

        const statusUrl = reseller.statusUrl || `${reseller.url}/api/admin/reseller/status`;
        const targetUrl = new URL(statusUrl);

        if (reseller.apiKey) {
          targetUrl.searchParams.set('key', reseller.apiKey);
        }

        const headers = {};

        if (reseller.apiKey) {
          headers['x-api-key'] = reseller.apiKey;
          headers['Authorization'] = `Bearer primora2026`;
        }

        const r = await fetch(targetUrl.toString(), {
          headers,
          signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (r.ok) {
          const data = await r.json();

          const remoteBalance = data.reseller_balance_primore !== undefined
            ? data.reseller_balance_primore
            : (data.reseller_balance !== undefined
              ? data.reseller_balance
              : data.balance);

          const remoteDeposit = data.total_deposit !== undefined
            ? data.total_deposit
            : (data.reseller_total_deposit_primore !== undefined
              ? data.reseller_total_deposit_primore
              : (data.reseller_total_deposit !== undefined
                ? data.reseller_total_deposit
                : data.deposit));

          if (remoteBalance !== undefined) {
            const parsedRemoteBalance = parseFloat(remoteBalance);

            if (Number.isFinite(parsedRemoteBalance)) {
              fetchedBalance = parsedRemoteBalance;
              remoteBalanceFound = true;
            }
          }

          if (remoteDeposit !== undefined) {
            const parsedRemoteDeposit = parseFloat(remoteDeposit);

            if (Number.isFinite(parsedRemoteDeposit)) {
              fetchedDeposit = parsedRemoteDeposit;
              remoteDepositFound = true;
            }
          }

          if (!Number.isFinite(fetchedBalance)) {
            fetchedBalance = cachedBalance !== undefined ? cachedBalance : 0;
          }

          if (!Number.isFinite(fetchedDeposit)) {
            fetchedDeposit = cachedDeposit !== undefined ? cachedDeposit : 0;
          }

          fetchSuccess = true;

          try {
            const rowsToSave = [];
            const persistBalance = remoteBalanceFound || cachedBalance !== undefined;
            const persistDeposit = remoteDepositFound || cachedDeposit !== undefined;

            if (persistBalance) {
              rowsToSave.push([cacheKeyBalance, String(fetchedBalance)]);
              if (resellerId === PRIMARY_RESELLER_ID) {
                rowsToSave.push(['reseller_balance_primore', String(fetchedBalance)]);
              }
            }

            if (persistDeposit) {
              rowsToSave.push([cacheKeyDeposit, String(fetchedDeposit)]);
              if (resellerId === PRIMARY_RESELLER_ID) {
                rowsToSave.push(['reseller_total_deposit_primore', String(fetchedDeposit)]);
                rowsToSave.push(['total_deposit', String(fetchedDeposit)]);
              }
            }

            if (rowsToSave.length > 0) {
              rowsToSave.push([cacheKeyTs, String(nowSec)]);

              const placeholders = rowsToSave.map(() => '(?, ?)').join(', ');
              const params = rowsToSave.flat();

              await pool.execute(
                `INSERT INTO settings (setting_key, setting_value)
                 VALUES ${placeholders}
                 ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
                params
              );
            }
          } catch (e) {}
        } else {
          errorMsg = `HTTP ${r.status}`;

          if (r.status === 429) {
            const backoffTs = nowSec + RATE_LIMIT_BACKOFF;

            try {
              await pool.execute(
                `INSERT INTO settings (setting_key, setting_value)
                 VALUES (?, ?)
                 ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
                [cacheKeyTs, String(backoffTs)]
              );
            } catch (e) {}
          }
        }
      } catch (e) {
        errorMsg = e.name === 'AbortError' ? 'Timeout' : e.message;
      }

      const hasFallback = cachedBalance !== undefined || cachedDeposit !== undefined;

      if (fetchSuccess) {
        results.push(buildResult(
          fetchedBalance,
          fetchedDeposit,
          {
            online: true
          }
        ));
      } else if (hasFallback) {
        results.push(buildResult(
          cachedBalance !== undefined ? cachedBalance : 0,
          cachedDeposit !== undefined ? cachedDeposit : 0,
          {
            online: cachedBalance !== undefined,
            notice: errorMsg === 'HTTP 429'
              ? 'Rate Limited (Using Cached Balance)'
              : (errorMsg ? `Degraded (Cached: ${errorMsg})` : 'Degraded (Cached)'),
            health: 'degraded'
          }
        ));
      } else if (errorMsg === 'HTTP 429') {
        results.push(buildResult(
          0,
          0,
          {
            online: false,
            notice: 'Rate Limited (Backoff)',
            health: 'degraded'
          }
        ));
      } else {
        results.push(buildResult(
          0,
          0,
          {
            online: false,
            error: errorMsg || 'Could not connect to panel'
          }
        ));
      }
    }

    return res.json({
      success: true,
      resellers: results
    });
  });

  router.post('/reseller/update-balances', async (req, res) => {
    try {
      const PRIMARY_RESELLER_ID = String(process.env.RESELLER_ID || 'primore').toLowerCase();
      const body = req.body || {};

      const rawResellerId = body.reseller_id !== undefined
        ? body.reseller_id
        : (body.id !== undefined ? body.id : PRIMARY_RESELLER_ID);

      const safeResellerId = String(rawResellerId)
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_-]/gi, '');

      if (!safeResellerId) {
        return res.status(400).json({
          error: 'reseller_id is required'
        });
      }

      const balanceInput = body.reseller_balance !== undefined
        ? body.reseller_balance
        : (body.reseller_balance_primore !== undefined
          ? body.reseller_balance_primore
          : body.balance);

      const depositInput = body.total_deposit !== undefined
        ? body.total_deposit
        : (body.reseller_total_deposit_primore !== undefined
          ? body.reseller_total_deposit_primore
          : (body.reseller_total_deposit !== undefined
            ? body.reseller_total_deposit
            : body.deposit));

      const parsedBalance = parseFloat(balanceInput);
      const parsedDeposit = parseFloat(depositInput);

      const balNum = Number.isFinite(parsedBalance) ? parsedBalance : 0;
      const depNum = Number.isFinite(parsedDeposit) ? parsedDeposit : 0;

      const balanceValue = balNum.toFixed(2);
      const depositValue = depNum.toFixed(2);
      const nowSec = Math.floor(Date.now() / 1000);

      const rowsToSave = [
        [`reseller_balance_${safeResellerId}`, balanceValue],
        [`reseller_total_deposit_${safeResellerId}`, depositValue],
        [`reseller_cache_ts_${safeResellerId}`, String(nowSec)]
      ];

      if (safeResellerId === PRIMARY_RESELLER_ID) {
        rowsToSave.push(['reseller_balance_primore', balanceValue]);
        rowsToSave.push(['reseller_total_deposit_primore', depositValue]);
        rowsToSave.push(['total_deposit', depositValue]);
      }

      const placeholders = rowsToSave.map(() => '(?, ?)').join(', ');
      const params = rowsToSave.flat();

      await pool.execute(
        `INSERT INTO settings (setting_key, setting_value)
         VALUES ${placeholders}
         ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
        params
      );

      return res.json({
        success: true,
        message: 'Reseller amounts updated successfully',
        reseller_id: safeResellerId,
        reseller_balance: Number(balanceValue),
        total_deposit: Number(depositValue),
        reseller_balance_primore: Number(balanceValue),
        reseller_total_deposit_primore: Number(depositValue)
      });
    } catch (err) {
      console.error('[reseller/update-balances]', err);

      return res.status(500).json({
        error: 'Failed to update reseller balance: ' + err.message
      });
    }
  });
}

export { registerResellerBalanceRoutes };
export default registerResellerBalanceRoutes;

