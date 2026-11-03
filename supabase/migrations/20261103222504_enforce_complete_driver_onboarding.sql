-- Enforce complete driver onboarding at the database boundary, not only in browser validation.
ALTER TABLE public.driver_profiles
  ALTER COLUMN license_number SET NOT NULL,
  ALTER COLUMN license_expiry SET NOT NULL,
  ALTER COLUMN vehicle_type SET NOT NULL,
  ALTER COLUMN vehicle_registration SET NOT NULL;
ALTER TABLE public.driver_profiles
  ADD CONSTRAINT driver_license_number_nonblank CHECK (length(trim(license_number)) BETWEEN 3 AND 80),
  ADD CONSTRAINT driver_vehicle_registration_nonblank CHECK (length(trim(vehicle_registration)) BETWEEN 3 AND 30),
  ADD CONSTRAINT driver_phone_nonblank CHECK (length(trim(phone)) BETWEEN 7 AND 30);
