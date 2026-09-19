const DEFAULT_RESELLER_ID = 'primore';

function getPrimaryResellerBalanceKey() {
  const rawResellerId = String(process.env.RESELLER_ID || DEFAULT_RESELLER_ID).trim();
  const resellerId = rawResellerId.replace(/[^a-z0-9_\-]/gi, '_');

  if (resellerId) {
    return `reseller_balance_${resellerId}`;
  }

  return 'reseller_balance_primore';
}

function normalizeBalanceValue(value) {
  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    return '0.0000';
  }

  return parsed.toFixed(4);
}

async function fetchPrimaryResellerBalance(executor, forUpdate = false) {
  const key = getPrimaryResellerBalanceKey();

  let sql = `
    SELECT setting_value
    FROM settings
    WHERE setting_key = ?
  `;

  if (forUpdate) {
    sql += ' FOR UPDATE';
  }

  const [rows] = await executor.query(sql, [key]);

  if (!rows || rows.length === 0) {
    return 0;
  }

  const value = rows[0].setting_value;
  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    return 0;
  }

  return parsed;
}

async function updatePrimaryResellerBalance(executor, newBalance) {
  const key = getPrimaryResellerBalanceKey();
  const value = normalizeBalanceValue(newBalance);

  const sql = `
    INSERT INTO settings (setting_key, setting_value, created_at)
    VALUES (?, ?, NOW())
    ON DUPLICATE KEY UPDATE setting_value = ?
  `;

  await executor.query(sql, [key, value, value]);

  return Number(value);
}

async function auditPrimaryResellerBalanceChange(executor, oldBalance, newBalance, reason) {
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
        ?,
        ?,
        ?,
        ?,
        NOW()
      )
    `;

    await executor.query(sql, [
      getPrimaryResellerBalanceKey(),
      normalizeBalanceValue(oldBalance),
      normalizeBalanceValue(newBalance),
      reason
    ]);
  } catch (err) {
    // Ignore if audit table absent
  }
}

async function adjustPrimaryResellerBalance(pool, delta, reason) {
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const currentBalance = await fetchPrimaryResellerBalance(connection, true);
    const newBalance = Math.max(0, Number(currentBalance) + Number(delta));
    const normalizedNewBalance = Number(normalizeBalanceValue(newBalance));

    await updatePrimaryResellerBalance(connection, normalizedNewBalance);
    await auditPrimaryResellerBalanceChange(
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
  getPrimaryResellerBalanceKey,
  normalizeBalanceValue,
  fetchPrimaryResellerBalance,
  updatePrimaryResellerBalance,
  adjustPrimaryResellerBalance
};
