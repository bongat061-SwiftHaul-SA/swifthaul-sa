ALTER TABLE customer_bookings ADD COLUMN payment_method TEXT NOT NULL DEFAULT 'dispatch' CHECK (payment_method IN ('cash','dispatch'));
ALTER TABLE customer_bookings ADD COLUMN counter_offer NUMERIC(20,2) CHECK (counter_offer > 0);
ALTER TABLE customer_bookings ADD COLUMN counter_offer_status TEXT NOT NULL DEFAULT 'none' CHECK (counter_offer_status IN ('none','pending','accepted','declined'));
ALTER TABLE customer_bookings ADD CONSTRAINT counter_offer_consistency CHECK ((counter_offer IS NULL AND counter_offer_status='none') OR (counter_offer IS NOT NULL AND counter_offer_status<>'none'));
ALTER TABLE customer_bookings ADD CONSTRAINT cash_distance_eligibility CHECK (payment_method <> 'cash' OR (distance_meters IS NOT NULL AND distance_meters < 12000));
ALTER TABLE customer_bookings ADD CONSTRAINT counter_offer_distance_eligibility CHECK (counter_offer IS NULL OR (distance_meters IS NOT NULL AND distance_meters < 24000));
