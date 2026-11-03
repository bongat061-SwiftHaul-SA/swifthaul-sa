ALTER TABLE customer_bookings
  ADD COLUMN IF NOT EXISTS pickup_latitude DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS pickup_longitude DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS pickup_plus_code TEXT,
  ADD COLUMN IF NOT EXISTS pickup_geohash TEXT,
  ADD COLUMN IF NOT EXISTS dropoff_latitude DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS dropoff_longitude DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS dropoff_plus_code TEXT,
  ADD COLUMN IF NOT EXISTS dropoff_geohash TEXT;

ALTER TABLE customer_bookings
  ADD CONSTRAINT customer_bookings_pickup_latitude_range CHECK (pickup_latitude IS NULL OR pickup_latitude BETWEEN -90 AND 90),
  ADD CONSTRAINT customer_bookings_pickup_longitude_range CHECK (pickup_longitude IS NULL OR pickup_longitude BETWEEN -180 AND 180),
  ADD CONSTRAINT customer_bookings_dropoff_latitude_range CHECK (dropoff_latitude IS NULL OR dropoff_latitude BETWEEN -90 AND 90),
  ADD CONSTRAINT customer_bookings_dropoff_longitude_range CHECK (dropoff_longitude IS NULL OR dropoff_longitude BETWEEN -180 AND 180),
  ADD CONSTRAINT customer_bookings_pickup_coordinate_pair CHECK ((pickup_latitude IS NULL) = (pickup_longitude IS NULL)),
  ADD CONSTRAINT customer_bookings_dropoff_coordinate_pair CHECK ((dropoff_latitude IS NULL) = (dropoff_longitude IS NULL)),
  ADD CONSTRAINT customer_bookings_pickup_plus_code_valid CHECK (pickup_plus_code IS NULL OR (length(pickup_plus_code) BETWEEN 4 AND 16 AND position('+' IN pickup_plus_code) > 0)),
  ADD CONSTRAINT customer_bookings_dropoff_plus_code_valid CHECK (dropoff_plus_code IS NULL OR (length(dropoff_plus_code) BETWEEN 4 AND 16 AND position('+' IN dropoff_plus_code) > 0)),
  ADD CONSTRAINT customer_bookings_pickup_geohash_valid CHECK (pickup_geohash IS NULL OR pickup_geohash ~ '^[0123456789bcdefghjkmnpqrstuvwxyz]{1,12}$'),
  ADD CONSTRAINT customer_bookings_dropoff_geohash_valid CHECK (dropoff_geohash IS NULL OR dropoff_geohash ~ '^[0123456789bcdefghjkmnpqrstuvwxyz]{1,12}$');

CREATE INDEX IF NOT EXISTS customer_bookings_pickup_geohash_idx ON customer_bookings (pickup_geohash) WHERE pickup_geohash IS NOT NULL;
CREATE INDEX IF NOT EXISTS customer_bookings_dropoff_geohash_idx ON customer_bookings (dropoff_geohash) WHERE dropoff_geohash IS NOT NULL;
