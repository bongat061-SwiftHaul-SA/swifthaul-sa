-- Permit only the dedicated driver portal to self-register as a pending driver.
-- Public metadata can request the driver role only; it can never grant dispatcher/admin.
CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  requested_driver boolean := COALESCE(NEW.raw_user_meta_data ->> 'app_type', '') = 'driver';
BEGIN
  INSERT INTO public.user_profiles (id, full_name, role)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data ->> 'full_name', ''),
    CASE WHEN requested_driver THEN 'driver' ELSE 'customer' END
  );

  IF requested_driver THEN
    INSERT INTO public.driver_profiles (user_id, phone, verification_status, availability_status)
    VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data ->> 'phone', ''), 'pending', 'offline');
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.handle_new_auth_user() FROM PUBLIC, anon, authenticated;
