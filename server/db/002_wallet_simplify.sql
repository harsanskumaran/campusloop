-- 002_wallet_simplify.sql
-- Run with: psql -U campusloop -d campusloop -h localhost -f db\002_wallet_simplify.sql
--
-- IMPORTANT: run this file as-is (do not wrap it in your own BEGIN/COMMIT).
-- ALTER TYPE ... ADD VALUE must run outside a transaction block in Postgres.

-- 1. Add new ledger types we now need (outside any transaction)
ALTER TYPE ledger_type ADD VALUE IF NOT EXISTS 'WITHDRAW';

-- Everything below is safe to run in one transaction
BEGIN;

-- 2. Fold any existing "coins" balance back into cash_balance, then drop the column
UPDATE wallet SET cash_balance = cash_balance + coins WHERE coins > 0;
ALTER TABLE wallet DROP COLUMN IF EXISTS coins;

-- 3. Rename held_coins -> held_cash (same purpose: escrow during an active booking)
ALTER TABLE wallet RENAME COLUMN held_coins TO held_cash;

-- 4. Track whether a user has withdrawn for the current/ended semester
ALTER TABLE wallet ADD COLUMN IF NOT EXISTS last_withdrawn_semester_id INT REFERENCES semester(id);

COMMIT;
