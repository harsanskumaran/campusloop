-- Run with: psql -U campusloop -d campusloop -h localhost -f db\004_registration_disputes.sql
-- Run after 003_booking_rules.sql. The enum updates must stay outside a transaction.
ALTER TYPE dispute_resolution ADD VALUE IF NOT EXISTS 'CUSTOM_SETTLEMENT';
ALTER TYPE deposit_outcome ADD VALUE IF NOT EXISTS 'SETTLED';

BEGIN;

ALTER TABLE app_user ADD COLUMN IF NOT EXISTS room_no TEXT;

CREATE TABLE IF NOT EXISTS cash_ledger (
  id          SERIAL PRIMARY KEY,
  wallet_id   INT NOT NULL REFERENCES wallet(id),
  type        ledger_type NOT NULL,
  amount      INT NOT NULL,
  booking_id  INT REFERENCES booking(id),
  note        TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF to_regclass('coin_ledger') IS NOT NULL THEN
    INSERT INTO cash_ledger (id, wallet_id, type, amount, booking_id, note, created_at)
    SELECT id, wallet_id, type, amount, booking_id, note, created_at
    FROM coin_ledger
    ON CONFLICT (id) DO NOTHING;
  END IF;
END
$$;

SELECT setval(
  pg_get_serial_sequence('cash_ledger', 'id'),
  COALESCE((SELECT MAX(id) FROM cash_ledger), 1),
  EXISTS (SELECT 1 FROM cash_ledger)
);

COMMIT;
