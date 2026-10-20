// src/modules/wallet/wallet.service.js
import { withTransaction, pool } from "../../config/db.js";

const MAX_CASH_BALANCE = 10000;

export class WalletError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

// Top up cash balance (mock payment — instantly succeeds)
export async function topUp(userId, amount) {
  if (amount <= 0) throw new WalletError("Top-up amount must be positive");

  return withTransaction(async (client) => {
    const walletResult = await client.query(
      "SELECT id, cash_balance FROM wallet WHERE user_id = $1 FOR UPDATE",
      [userId]
    );
    const wallet = walletResult.rows[0];
    if (!wallet) throw new WalletError("Wallet not found", 404);

    const newBalance = wallet.cash_balance + amount;
    if (newBalance > MAX_CASH_BALANCE) {
      throw new WalletError(
        `Top-up would exceed the ₹${MAX_CASH_BALANCE} wallet cap. Current balance: ₹${wallet.cash_balance}`
      );
    }

    await client.query("UPDATE wallet SET cash_balance = $1 WHERE id = $2", [
      newBalance,
      wallet.id,
    ]);
    await client.query(
      `INSERT INTO cash_ledger (wallet_id, type, amount, note)
       VALUES ($1, 'TOPUP', $2, 'Wallet top-up (mock)')`,
      [wallet.id, amount]
    );

    return { cashBalance: newBalance };
  });
}

// Get wallet summary for a user
export async function getWallet(userId) {
  const result = await pool.query(
    "SELECT id, cash_balance, held_cash, last_withdrawn_semester_id FROM wallet WHERE user_id = $1",
    [userId]
  );
  const wallet = result.rows[0];
  if (!wallet) throw new WalletError("Wallet not found", 404);
  return wallet;
}

// Hold cash in escrow when a booking is confirmed (rent + deposit)
export async function holdCash(userId, amount, bookingId, client) {
  const walletResult = await client.query(
    "SELECT id, cash_balance, held_cash FROM wallet WHERE user_id = $1 FOR UPDATE",
    [userId]
  );
  const wallet = walletResult.rows[0];
  if (!wallet) throw new WalletError("Wallet not found", 404);
  if (wallet.cash_balance < amount) {
    throw new WalletError(`Not enough balance. Have ₹${wallet.cash_balance}, need ₹${amount}`);
  }

  await client.query(
    "UPDATE wallet SET cash_balance = cash_balance - $1, held_cash = held_cash + $1 WHERE id = $2",
    [amount, wallet.id]
  );
  await client.query(
    `INSERT INTO cash_ledger (wallet_id, type, amount, booking_id, note)
     VALUES ($1, 'HOLD', $2, $3, 'Cash held for booking')`,
    [wallet.id, amount, bookingId]
  );
}

// Release held cash back to spendable balance (e.g. booking cancelled before pickup)
export async function releaseCash(userId, amount, bookingId, client) {
  const walletResult = await client.query(
    "SELECT id FROM wallet WHERE user_id = $1 FOR UPDATE",
    [userId]
  );
  const wallet = walletResult.rows[0];
  if (!wallet) throw new WalletError("Wallet not found", 404);

  await client.query(
    "UPDATE wallet SET cash_balance = cash_balance + $1, held_cash = GREATEST(held_cash - $1, 0) WHERE id = $2",
    [amount, wallet.id]
  );
  await client.query(
    `INSERT INTO cash_ledger (wallet_id, type, amount, booking_id, note)
     VALUES ($1, 'RELEASE', $2, $3, 'Held cash released')`,
    [wallet.id, amount, bookingId]
  );
}

// Credit cash to a user directly (e.g. rent released to lender on drop-accept,
// or deposit deduction credited to lender). Does NOT touch held_cash —
// use this for money that lands directly in spendable balance.
export async function creditCash(userId, amount, type, bookingId, note, client) {
  const walletResult = await client.query(
    "SELECT id FROM wallet WHERE user_id = $1 FOR UPDATE",
    [userId]
  );
  const wallet = walletResult.rows[0];
  if (!wallet) throw new WalletError("Wallet not found", 404);

  await client.query("UPDATE wallet SET cash_balance = cash_balance + $1 WHERE id = $2", [
    amount,
    wallet.id,
  ]);
  await client.query(
    `INSERT INTO cash_ledger (wallet_id, type, amount, booking_id, note)
     VALUES ($1, $2, $3, $4, $5)`,
    [wallet.id, type, amount, bookingId, note]
  );
}

// Reduce a borrower's held_cash (used when settling a deposit: the held
// deposit portion is removed from escrow and credited to the lender instead
// of being returned to the borrower).
export async function deductHeldCash(userId, amount, bookingId, note, client, ledgerType = "DAMAGE_DEDUCTION") {
  const walletResult = await client.query(
    "SELECT id, held_cash FROM wallet WHERE user_id = $1 FOR UPDATE",
    [userId]
  );
  const wallet = walletResult.rows[0];
  if (!wallet) throw new WalletError("Wallet not found", 404);
  if (wallet.held_cash < amount) {
    throw new WalletError(`Held cash (₹${wallet.held_cash}) is less than deduction (₹${amount})`);
  }

  await client.query("UPDATE wallet SET held_cash = held_cash - $1 WHERE id = $2", [
    amount,
    wallet.id,
  ]);
  await client.query(
    `INSERT INTO cash_ledger (wallet_id, type, amount, booking_id, note)
     VALUES ($1, $5, $2, $3, $4)`,
    [wallet.id, amount, bookingId, note, ledgerType]
  );
}

// Withdraw the full wallet balance — only allowed once the user's semester has ended
export async function withdraw(userId) {
  return withTransaction(async (client) => {
    const result = await client.query(
      `SELECT w.id AS wallet_id, w.cash_balance, w.held_cash, w.last_withdrawn_semester_id,
              u.semester_id, s.ends_on, s.is_active
       FROM wallet w
       JOIN app_user u ON u.id = w.user_id
       LEFT JOIN semester s ON s.id = u.semester_id
       WHERE w.user_id = $1
       FOR UPDATE OF w`,
      [userId]
    );
    const row = result.rows[0];
    if (!row) throw new WalletError("Wallet not found", 404);
    if (!row.semester_id) throw new WalletError("No semester on record for this user");

    const semesterEnded = row.is_active === false || new Date(row.ends_on) <= new Date();
    if (!semesterEnded) {
      throw new WalletError(
        `Withdrawals open once the semester ends (${new Date(row.ends_on).toDateString()})`
      );
    }
    if (row.last_withdrawn_semester_id === row.semester_id) {
      throw new WalletError("Already withdrawn for this semester");
    }
    if (row.held_cash > 0) {
      throw new WalletError(
        `Cannot withdraw yet — ₹${row.held_cash} is still held in an active booking`
      );
    }
    if (row.cash_balance <= 0) {
      throw new WalletError("Nothing to withdraw");
    }

    const amount = row.cash_balance;
    await client.query(
      "UPDATE wallet SET cash_balance = 0, last_withdrawn_semester_id = $1 WHERE id = $2",
      [row.semester_id, row.wallet_id]
    );
    await client.query(
      `INSERT INTO cash_ledger (wallet_id, type, amount, note)
       VALUES ($1, 'WITHDRAW', $2, 'End-of-semester withdrawal')`,
      [row.wallet_id, amount]
    );

    return { withdrawn: amount };
  });
}
