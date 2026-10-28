-- Run with: psql -U campusloop -d campusloop -h localhost -f db\006_booking_extensions.sql
-- Supports borrower requests to extend an existing booking's return date.

CREATE TABLE IF NOT EXISTS booking_extension (
  id                 SERIAL PRIMARY KEY,
  booking_id         INT NOT NULL REFERENCES booking(id),
  borrower_id        INT NOT NULL REFERENCES app_user(id),
  lender_id          INT NOT NULL REFERENCES app_user(id),
  requested_end_date TIMESTAMPTZ NOT NULL,
  additional_rent    INT NOT NULL CHECK (additional_rent > 0),
  status             TEXT NOT NULL DEFAULT 'PENDING'
                     CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_at         TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_booking_extension_booking_created
  ON booking_extension(booking_id, created_at DESC);
