ALTER TABLE customer_bookings ADD COLUMN scheduled_at TIMESTAMPTZ;
ALTER TABLE customer_bookings ADD COLUMN return_address TEXT;
ALTER TABLE customer_bookings ADD COLUMN return_at TIMESTAMPTZ;
CREATE TABLE customer_profiles (
  owner_hash TEXT PRIMARY KEY,
  full_name TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  details TEXT NOT NULL DEFAULT '',
  bank_name TEXT NOT NULL DEFAULT '',
  account_holder TEXT NOT NULL DEFAULT '',
  account_number TEXT NOT NULL DEFAULT '',
  branch_code TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE customer_deletions (owner_hash TEXT PRIMARY KEY, requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
