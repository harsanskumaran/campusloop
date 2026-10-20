-- 003_booking_rules.sql
-- Run with: psql -U campusloop -d campusloop -h localhost -f db\003_booking_rules.sql
--
-- IMPORTANT: run this file as-is (do not wrap it in your own BEGIN/COMMIT).
-- ALTER TYPE ... ADD VALUE must run outside a transaction block in Postgres.

-- New enum values needed
ALTER TYPE booking_status ADD VALUE IF NOT EXISTS 'ON_HOLD';

BEGIN;

-- 1. Extension requests: a borrower asks a lender to allow one more rental
--    of an item this month, beyond its normal monthly cap.
CREATE TYPE extension_status AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

CREATE TABLE extension_request (
  id             SERIAL PRIMARY KEY,
  item_id        INT NOT NULL REFERENCES item(id),
  requested_by   INT NOT NULL REFERENCES app_user(id),  -- borrower
  lender_id      INT NOT NULL REFERENCES app_user(id),
  month_year     TEXT NOT NULL,  -- e.g. '2026-09', the calendar month this applies to
  status         extension_status NOT NULL DEFAULT 'PENDING',
  note           TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_at     TIMESTAMPTZ
);
CREATE INDEX idx_extension_item_month ON extension_request(item_id, month_year);

-- 2. Dispute resolution workflow: status + admin decision fields
CREATE TYPE dispute_status AS ENUM ('OPEN', 'RESOLVED');
CREATE TYPE dispute_resolution AS ENUM ('NO_REFUND', 'OFFLINE_SETTLED', 'RELEASED_NO_ACTION');

ALTER TABLE dispute ADD COLUMN IF NOT EXISTS status dispute_status NOT NULL DEFAULT 'OPEN';
ALTER TABLE dispute ADD COLUMN IF NOT EXISTS resolution dispute_resolution;
ALTER TABLE dispute ADD COLUMN IF NOT EXISTS resolved_by INT REFERENCES app_user(id);
ALTER TABLE dispute ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ;
ALTER TABLE dispute ADD COLUMN IF NOT EXISTS resolution_note TEXT;

-- 3. Track whether a booking's deposit was refunded, forfeited, or is on hold
CREATE TYPE deposit_outcome AS ENUM ('PENDING', 'REFUNDED', 'FORFEITED', 'ON_HOLD');
ALTER TABLE booking ADD COLUMN IF NOT EXISTS deposit_outcome deposit_outcome NOT NULL DEFAULT 'PENDING';

-- 4. Index to make "how many bookings has this user made this calendar month"
--    fast to compute directly from the booking table (no separate counter table
--    needed — we derive it from created_at each time it's checked).
CREATE INDEX IF NOT EXISTS idx_booking_borrower_created ON booking(borrower_id, created_at);

COMMIT;
