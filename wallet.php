<?php
/**
 * Wallet Transactions Helper
 */

require_once __DIR__ . '/config.php';

/**
 * Process a user wallet transaction atomically.
 * Must be executed within a PDO transaction.
 *
 * @param string $tgId - Telegram user ID
 * @param string $type - Transaction type (deposit, order, refund, etc.)
 * @param float $amount - Amount to credit (positive) or debit (negative)
 * @param string $description - Transaction description
 * @param PDO $pdo - Active PDO database handle
 * @param string|null $refType - Optional reference table name
 * @param int|null $refId - Optional reference primary key
 * @return float New balance
 */
function processTransaction($tgId, $type, $amount, $description, $pdo, $refType = null, $refId = null) {
    // 1. Update User Balance
    $stmt = $pdo->prepare('UPDATE auth SET balance = balance + :amount WHERE tg_id = :tg_id');
    $stmt->execute(['amount' => $amount, 'tg_id' => $tgId]);

    // 2. Fetch New Balance
    $stmt = $pdo->prepare('SELECT balance FROM auth WHERE tg_id = :tg_id');
    $stmt->execute(['tg_id' => $tgId]);
    $user = $stmt->fetch();
    if (!$user) {
        throw new Exception("User not found: {$tgId}");
    }
    $newBalance = (float)$user['balance'];

    // 3. Log to Transactions Ledger
    $stmt = $pdo->prepare('
        INSERT INTO transactions (user_id, type, amount, balance_after, reference_type, reference_id, description) 
        VALUES (:user_id, :type, :amount, :balance_after, :reference_type, :reference_id, :description)
    ');
    $stmt->execute([
        'user_id'        => $tgId,
        'type'           => $type,
        'amount'         => $amount,
        'balance_after'  => $newBalance,
        'reference_type' => $refType,
        'reference_id'   => $refId,
        'description'    => $description
    ]);

    // 4. Handle Referral Commissions (7% of deposits)
    if ($type === 'deposit' && $amount > 0) {
        try {
            $stmt = $pdo->prepare('SELECT referred_by FROM auth WHERE tg_id = :tg_id');
            $stmt->execute(['tg_id' => $tgId]);
            $uRow = $stmt->fetch();
            
            if ($uRow && !empty($uRow['referred_by'])) {
                $referrerId = (string)$uRow['referred_by'];
                $commission = $amount * 0.07;

                // Update referrer balance
                $stmt = $pdo->prepare('UPDATE auth SET balance = balance + :commission WHERE tg_id = :tg_id');
                $stmt->execute(['commission' => $commission, 'tg_id' => $referrerId]);

                // Fetch referrer new balance
                $stmt = $pdo->prepare('SELECT balance FROM auth WHERE tg_id = :tg_id');
                $stmt->execute(['tg_id' => $referrerId]);
                $rRow = $stmt->fetch();
                $refNewBal = $rRow ? (float)$rRow['balance'] : 0.0;

                // Log ledger transaction for referrer
                $stmt = $pdo->prepare('
                    INSERT INTO transactions (user_id, type, amount, balance_after, reference_type, reference_id, description) 
                    VALUES (:user_id, :type, :amount, :balance_after, :reference_type, :reference_id, :description)
                ');
                $stmt->execute([
                    'user_id'        => $referrerId,
                    'type'           => 'referral_commission',
                    'amount'         => $commission,
                    'balance_after'  => $refNewBal,
                    'reference_type' => 'referral_user',
                    'reference_id'   => $tgId,
                    'description'    => "7% referral commission from user #{$tgId} deposit"
                ]);

                // Add in-app notification alert for referrer
                $stmt = $pdo->prepare('
                    INSERT INTO alerts (user_id, title, message, type) 
                    VALUES (:user_id, :title, :message, :type)
                ');
                $stmt->execute([
                    'user_id' => $referrerId,
                    'title'   => 'Referral Commission',
                    'message' => "You earned " . number_format($commission, 2) . " ETB (7%) from your referred friend's deposit!",
                    'type'    => 'success'
                ]);
            }
        } catch (Exception $e) {
            error_log('Failed to reward referral commission: ' . $e->getMessage());
        }
    }

    return $newBalance;
}
