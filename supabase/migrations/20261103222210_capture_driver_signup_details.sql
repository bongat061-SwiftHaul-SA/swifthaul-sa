-- Capture driver onboarding details at signup. Metadata can only create a pending driver profile.
CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  requested_driver boolean := COALESCE(NEW.raw_user_meta_data ->> 'app_type', '') = 'driver';
BEGIN
  INSERT INTO public.user_profiles (id, full_name, phone, role)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data ->> 'full_name', ''),
    CASE WHEN requested_driver THEN COALESCE(NEW.raw_user_meta_data ->> 'phone', '') ELSE '' END,
    CASE WHEN requested_driver THEN 'driver' ELSE 'customer' END
  );

  IF requested_driver THEN
    INSERT INTO public.driver_profiles (
      user_id, phone, license_number, license_expiry, vehicle_type,
      vehicle_registration, verification_status, availability_status
    ) VALUES (
      NEW.id,
      COALESCE(NEW.raw_user_meta_data ->> 'phone', ''),
      NULLIF(NEW.raw_user_meta_data ->> 'license_number', ''),
      NULLIF(NEW.raw_user_meta_data ->> 'license_expiry', '')::date,
      NULLIF(NEW.raw_user_meta_data ->> 'vehicle_type', ''),
      NULLIF(NEW.raw_user_meta_data ->> 'vehicle_registration', ''),
      'pending',
      'offline'
    );
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.handle_new_auth_user() FROM PUBLIC, anon, authenticated;
