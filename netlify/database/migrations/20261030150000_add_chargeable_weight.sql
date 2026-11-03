-- Preserve historical whole-rand fares while allowing cents for weight surcharges.
ALTER TABLE delivery_quotes ALTER COLUMN price TYPE NUMERIC(20,2);
ALTER TABLE customer_bookings ALTER COLUMN price TYPE NUMERIC(20,2);
ALTER TABLE delivery_quotes ADD COLUMN load JSONB;
ALTER TABLE delivery_quotes ADD COLUMN distance_fee NUMERIC(20,2);
ALTER TABLE customer_bookings ADD COLUMN load JSONB;
ALTER TABLE customer_bookings ADD COLUMN distance_fee NUMERIC(20,2);
