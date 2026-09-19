const DEFAULT_RESELLER_ID = 'primore';

function getResellerBalanceKeys() {
  const rawResellerId = String(process.env.RESELLER_ID || DEFAULT_RESELLER_ID).trim();
  const resellerId = rawResellerId.replace(/[^a-z0-9_\-]/gi, '_');

  const keys = ['reseller_balance'];

  if (resellerId) {
    keys.unshift(`reseller_balance_${resellerId}`);
  }

  return [...new Set(keys)];
}

function normalizeBalanceValue(value) {
  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    return '0.0000';
  }

  return parsed.toFixed(4);
}

async function fetchResellerBalanceRows(executor, forUpdate = false) {
  const keys = getResellerBalanceKeys();
  const placeholders = keys.map(() => '?').join(', ');

  let sql = `
    SELECT setting_key, setting_value
    FROM settings
    WHERE setting_key IN (${placeholders})
  `;

  if (forUpdate) {
    sql += ' FOR UPDATE';
  }

  const [rows] = await executor.query(sql, keys);

  const map = {};

  for (const row of rows) {
    map[row.setting_key] = row.setting_value;
  }

  return map;
}

async function fetchResellerBalance(executor, forUpdate = false) {
  const keys = getResellerBalanceKeys();
  const rows = await fetchResellerBalanceRows(executor, forUpdate);

  for (const key of keys) {
    const value = rows[key];

    if (value !== undefined && value !== null && String(value).trim() !== '') {
      const parsed = Number(value);

      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }

  return 0;
}

async function updateResellerBalanceDual(executor, newBalance) {
  const keys = getResellerBalanceKeys();
  const value = normalizeBalanceValue(newBalance);

  const sql = `
    INSERT INTO settings (setting_key, setting_value, created_at)
    VALUES (?, ?, NOW())
    ON DUPLICATE KEY UPDATE setting_value = ?
  `;

  for (const key of keys) {
    await executor.query(sql, [key, value, value]);
  }

  return Number(value);
}

async function auditResellerBalanceChange(executor, oldBalance, newBalance, reason) {
  try {
    const sql = `
      INSERT INTO settings_audit (
        setting_key,
        old_value,
        new_value,
        change_reason,
        created_at
      )
      VALUES (
        'reseller_balance',
        ?,
        ?,
        ?,
        NOW()
      )
    `;

    await executor.query(sql, [
      normalizeBalanceValue(oldBalance),
      normalizeBalanceValue(newBalance),
      reason
    ]);
  } catch (err) {
    // Ignore if audit table not present
  }
}

async function syncResellerBalanceKeys(executor, forUpdate = false) {
  const keys = getResellerBalanceKeys();
  const rows = await fetchResellerBalanceRows(executor, forUpdate);

  let target = null;
  let oldForAudit = 0;

  for (const key of keys) {
    const value = rows[key];

    if (value !== undefined && value !== null && String(value).trim() !== '') {
      const parsed = Number(value);

      if (Number.isFinite(parsed)) {
        target = parsed;
        oldForAudit = parsed;
        break;
      }
    }
  }

  if (target === null) {
    target = 0;
  }

  const targetValue = normalizeBalanceValue(target);
  let needsSync = false;

  for (const key of keys) {
    const value = rows[key];

    if (value === undefined || value === null) {
      needsSync = true;
      break;
    }

    if (normalizeBalanceValue(value) !== targetValue) {
      needsSync = true;
      break;
    }
  }

  if (needsSync) {
    await updateResellerBalanceDual(executor, targetValue);
    await auditResellerBalanceChange(executor, oldForAudit, targetValue, 'dual_key_sync');
  }

  return Number(targetValue);
}

async function adjustResellerBalanceDual(pool, delta, reason) {
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const currentBalance = await syncResellerBalanceKeys(connection, true);
    const newBalance = Math.max(0, Number(currentBalance) + Number(delta));
    const normalizedNewBalance = Number(normalizeBalanceValue(newBalance));

    await updateResellerBalanceDual(connection, normalizedNewBalance);
    await auditResellerBalanceChange(
      connection,
      currentBalance,
      normalizedNewBalance,
      reason
    );

    await connection.commit();

    return normalizedNewBalance;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

module.exports = {
  getResellerBalanceKeys,
  normalizeBalanceValue,
  fetchResellerBalance,
  updateResellerBalanceDual,
  syncResellerBalanceKeys,
  adjustResellerBalanceDual
};
