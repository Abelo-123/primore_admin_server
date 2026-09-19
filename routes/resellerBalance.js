const express = require('express');
const mysql = require('mysql2/promise');

const {
  syncResellerBalanceKeys,
  adjustResellerBalanceDual,
  getResellerBalanceKeys
} = require('../utils/resellerBalance');

const router = express.Router();

const needsSsl = String(process.env.DB_HOST || '').includes('aivencloud.com');

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 19851),
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 5,
  ssl: needsSsl ? { rejectUnauthorized: false } : undefined
});

router.get('/status', async (req, res) => {
  try {
    const syncedBalance = await syncResellerBalanceKeys(pool, false);

    const [rows] = await pool.query(
      `SELECT setting_key, setting_value
         FROM settings
        WHERE setting_key IN (
          'total_deposit',
          'min_rate_multiplier',
          'rate_multiplier'
        )`
    );

    const settingsMap = {};

    for (const row of rows) {
      settingsMap[row.setting_key] = row.setting_value;
    }

    res.json({
      success: true,
      reseller_balance: Number(syncedBalance.toFixed(2)),
      reseller_balance_primore: Number(syncedBalance.toFixed(2)),
      total_deposit: Number(settingsMap.total_deposit || 0),
      min_rate_multiplier: Number(settingsMap.min_rate_multiplier || 200),
      rate_multiplier: Number(settingsMap.rate_multiplier || 220),
      balance_keys: getResellerBalanceKeys()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to load reseller status'
    });
  }
});

router.post('/add-balance', async (req, res) => {
  try {
    const amount = Number(req.body?.amount || 0);

    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(422).json({
        success: false,
        error: 'Amount must be greater than zero'
      });
    }

    const newBalance = await adjustResellerBalanceDual(
      pool,
      amount,
      'admin_add_balance'
    );

    res.json({
      success: true,
      new_balance: Number(newBalance.toFixed(2)),
      reseller_balance: Number(newBalance.toFixed(2)),
      reseller_balance_primore: Number(newBalance.toFixed(2)),
      balance_keys: getResellerBalanceKeys()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to add reseller balance'
    });
  }
});

router.post('/adjust-balance', async (req, res) => {
  try {
    const delta = Number(req.body?.delta ?? req.body?.amount ?? 0);
    const reason = String(req.body?.reason || 'admin_adjust_balance').trim();

    if (!Number.isFinite(delta) || delta === 0) {
      return res.status(422).json({
        success: false,
        error: 'Delta must not be zero'
      });
    }

    const newBalance = await adjustResellerBalanceDual(
      pool,
      delta,
      reason || 'admin_adjust_balance'
    );

    res.json({
      success: true,
      new_balance: Number(newBalance.toFixed(2)),
      reseller_balance: Number(newBalance.toFixed(2)),
      reseller_balance_primore: Number(newBalance.toFixed(2)),
      balance_keys: getResellerBalanceKeys()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to adjust reseller balance'
    });
  }
});

module.exports = router;
