CREATE TABLE delivery_quotes (
  id UUID PRIMARY KEY,
  owner_hash TEXT NOT NULL,
  pickup TEXT NOT NULL,
  dropoff TEXT NOT NULL,
  vehicle TEXT NOT NULL CHECK (vehicle IN ('bike','van','truck')),
  distance_meters DOUBLE PRECISION NOT NULL CHECK (distance_meters >= 0 AND distance_meters < 'Infinity'::float8),
  price_band INTEGER NOT NULL CHECK (price_band >= 0),
  price BIGINT NOT NULL CHECK (price > 0 AND price <= 9007199254740991),
  route JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '15 minutes')
);
CREATE INDEX delivery_quotes_owner_expires ON delivery_quotes (owner_hash, expires_at);
ALTER TABLE customer_bookings DROP CONSTRAINT customer_bookings_vehicle_check;
ALTER TABLE customer_bookings ADD CONSTRAINT customer_bookings_vehicle_check CHECK (vehicle IN ('bike','bakkie','van','truck'));
ALTER TABLE customer_bookings ALTER COLUMN price TYPE BIGINT;
ALTER TABLE customer_bookings ADD COLUMN distance_meters DOUBLE PRECISION CHECK (distance_meters >= 0 AND distance_meters < 'Infinity'::float8);
ALTER TABLE customer_bookings ADD COLUMN price_band INTEGER CHECK (price_band >= 0);
ALTER TABLE customer_bookings ADD COLUMN quote_id UUID UNIQUE REFERENCES delivery_quotes(id);
