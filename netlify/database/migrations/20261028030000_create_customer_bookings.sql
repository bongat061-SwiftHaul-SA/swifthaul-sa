CREATE TABLE customer_bookings (
  waybill TEXT PRIMARY KEY,
  owner_hash TEXT NOT NULL,
  pin TEXT NOT NULL,
  pickup TEXT NOT NULL,
  dropoff TEXT NOT NULL,
  recipient TEXT NOT NULL,
  vehicle TEXT NOT NULL CHECK (vehicle IN ('bike', 'bakkie', 'van')),
  price INTEGER NOT NULL CHECK (price > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX customer_bookings_owner_created ON customer_bookings (owner_hash, created_at DESC);
