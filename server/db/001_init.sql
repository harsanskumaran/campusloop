-- CampusLoop: initial schema
-- Run with: psql -U campusloop -d campusloop -h localhost -f db/001_init.sql

BEGIN;

-- ===== ENUMS =====
CREATE TYPE user_role     AS ENUM ('USER', 'ADMIN');
CREATE TYPE user_status   AS ENUM ('ACTIVE', 'EXCEEDED', 'SUSPENDED');
CREATE TYPE item_tier     AS ENUM ('STANDARD', 'HIGH_VALUE');
CREATE TYPE item_status   AS ENUM (
  'DRAFT','LISTED','BOOKED','WITH_BORROWER','COOLING',
  'UNDER_REPAIR','PAUSED','DELISTED','SOLD','LOST'
);
CREATE TYPE booking_type   AS ENUM ('RENT', 'PURCHASE');
CREATE TYPE booking_status AS ENUM (
  'REQUESTED','REJECTED','EXPIRED','CONSENT_PENDING','CONFIRMED','CANCELLED',
  'PICKUP_READY','NO_SHOW','PICKED_UP','OVERDUE','DROP_SUBMITTED','VERIFIED',
  'COOLING','UNDER_REPAIR','DISPUTED','LOST_ESCALATION','COMPLETED'
);
CREATE TYPE ledger_type    AS ENUM (
  'TOPUP','CONVERT','HOLD','RELEASE','RENT_PAYMENT','DEPOSIT_REFUND',
  'DAMAGE_DEDUCTION','PURCHASE','REFUND','ADJUSTMENT'
);
CREATE TYPE consent_stage  AS ENUM ('BOOKING', 'PICKUP', 'DROP');
CREATE TYPE photo_kind     AS ENUM ('ITEM', 'BOOKING_CONSENT', 'PICKUP', 'DROP', 'INSPECTION');

-- ===== SEMESTER =====
CREATE TABLE semester (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  starts_on   TIMESTAMPTZ NOT NULL,
  ends_on     TIMESTAMPTZ NOT NULL,
  is_active   BOOLEAN NOT NULL DEFAULT FALSE
);

-- ===== USERS =====
CREATE TABLE app_user (
  id             SERIAL PRIMARY KEY,
  name           TEXT NOT NULL,
  email          TEXT NOT NULL UNIQUE,
  phone          TEXT,
  room_no        TEXT,
  password_hash  TEXT NOT NULL,
  role           user_role   NOT NULL DEFAULT 'USER',
  status         user_status NOT NULL DEFAULT 'ACTIVE',
  campus_id      TEXT UNIQUE,
  semester_id    INT REFERENCES semester(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ===== WALLET =====
CREATE TABLE wallet (
  id            SERIAL PRIMARY KEY,
  user_id       INT NOT NULL UNIQUE REFERENCES app_user(id),
  cash_balance  INT NOT NULL DEFAULT 0 CHECK (cash_balance BETWEEN 0 AND 10000),
  coins         INT NOT NULL DEFAULT 0 CHECK (coins >= 0),
  held_coins    INT NOT NULL DEFAULT 0 CHECK (held_coins >= 0)
);

CREATE TABLE coin_ledger (
  id          SERIAL PRIMARY KEY,
  wallet_id   INT NOT NULL REFERENCES wallet(id),
  type        ledger_type NOT NULL,
  amount      INT NOT NULL,
  booking_id  INT,
  note        TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ===== ITEMS =====
CREATE TABLE item (
  id              SERIAL PRIMARY KEY,
  owner_id        INT NOT NULL REFERENCES app_user(id),
  title           TEXT NOT NULL,
  description     TEXT NOT NULL,
  category        TEXT NOT NULL,
  declared_value  INT NOT NULL,
  tier            item_tier   NOT NULL DEFAULT 'STANDARD',
  rent_per_day    INT,
  sale_price      INT,
  deposit         INT NOT NULL DEFAULT 0,
  known_defects   TEXT,
  status          item_status NOT NULL DEFAULT 'LISTED',
  cooling_until   TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ===== BOOKINGS =====
CREATE TABLE booking (
  id             SERIAL PRIMARY KEY,
  type           booking_type   NOT NULL DEFAULT 'RENT',
  item_id        INT NOT NULL REFERENCES item(id),
  borrower_id    INT NOT NULL REFERENCES app_user(id),
  lender_id      INT NOT NULL REFERENCES app_user(id),
  start_date     TIMESTAMPTZ NOT NULL,
  end_date       TIMESTAMPTZ NOT NULL,
  rent_coins     INT NOT NULL DEFAULT 0,
  deposit_coins  INT NOT NULL DEFAULT 0,
  status         booking_status NOT NULL DEFAULT 'REQUESTED',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_booking_item_dates ON booking(item_id, start_date, end_date);

ALTER TABLE coin_ledger
  ADD CONSTRAINT fk_ledger_booking FOREIGN KEY (booking_id) REFERENCES booking(id);

-- ===== CONSENT =====
CREATE TABLE consent (
  id          SERIAL PRIMARY KEY,
  booking_id  INT NOT NULL REFERENCES booking(id),
  stage       consent_stage NOT NULL,
  signed_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  note        TEXT
);

-- ===== INSPECTIONS =====
CREATE TABLE inspection (
  id          SERIAL PRIMARY KEY,
  item_id     INT NOT NULL REFERENCES item(id),
  booking_id  INT REFERENCES booking(id),
  passed      BOOLEAN NOT NULL,
  notes       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ===== DISPUTES =====
CREATE TABLE dispute (
  id            SERIAL PRIMARY KEY,
  booking_id    INT NOT NULL REFERENCES booking(id),
  raised_by_id  INT NOT NULL REFERENCES app_user(id),
  claim_coins   INT,
  reason        TEXT NOT NULL,
  outcome       TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ===== QUOTA USAGE (one row per counted activity) =====
CREATE TABLE quota_usage (
  id           SERIAL PRIMARY KEY,
  user_id      INT NOT NULL REFERENCES app_user(id),
  semester_id  INT NOT NULL REFERENCES semester(id),
  kind         TEXT NOT NULL,   -- 'POST' | 'BOOKING'
  ref_id       INT NOT NULL,
  restored     BOOLEAN NOT NULL DEFAULT FALSE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_quota_user_sem ON quota_usage(user_id, semester_id);

-- ===== BLOCK LIST =====
CREATE TABLE block_list (
  id           SERIAL PRIMARY KEY,
  lender_id    INT NOT NULL REFERENCES app_user(id),
  borrower_id  INT NOT NULL REFERENCES app_user(id),
  UNIQUE (lender_id, borrower_id)
);

-- ===== PHOTOS (local disk storage — see Section on local photos) =====
CREATE TABLE photo (
  id             SERIAL PRIMARY KEY,
  kind           photo_kind NOT NULL,
  path           TEXT NOT NULL,      -- relative path inside uploads/
  sha256         TEXT NOT NULL,
  size_bytes     INT NOT NULL,
  uploaded_by    INT NOT NULL REFERENCES app_user(id),
  item_id        INT REFERENCES item(id),
  booking_id     INT REFERENCES booking(id),
  inspection_id  INT REFERENCES inspection(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_photo_booking_kind ON photo(booking_id, kind);

COMMIT;
