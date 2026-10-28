-- 005_handover_comments.sql
-- Run with: psql -U campusloop -d campusloop -h localhost -f db\005_handover_comments.sql
-- Safe to run more than once.
--
-- Pickup/drop no longer use photos. Instead:
--   * borrower writes a comment at pickup  (stored in consent.note, stage PICKUP)
--   * borrower may add a note at drop      (stored in consent.note, stage DROP)
--   * lender MUST write a comment when accepting / reporting the return (review_note)
--   * if the lender does nothing for 24h after the drop, the booking goes ON_HOLD
--     for the admin (needs to know when the drop happened -> drop_submitted_at)

ALTER TABLE booking ADD COLUMN IF NOT EXISTS drop_submitted_at TIMESTAMPTZ;
ALTER TABLE booking ADD COLUMN IF NOT EXISTS review_note       TEXT;
ALTER TABLE booking ADD COLUMN IF NOT EXISTS reviewed_at       TIMESTAMPTZ;

-- Returns already waiting for a lender review get a fresh 24 hours from now,
-- so running this migration does not instantly put them on hold.
UPDATE booking SET drop_submitted_at = now()
WHERE status = 'DROP_SUBMITTED' AND drop_submitted_at IS NULL;
