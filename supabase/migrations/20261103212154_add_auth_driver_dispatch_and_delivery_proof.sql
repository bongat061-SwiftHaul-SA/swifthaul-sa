-- Supabase Auth, driver, dispatch and proof-of-delivery foundation.
-- Browser roles remain denied direct access; trusted Edge Functions enforce business permissions.

CREATE TABLE public.user_profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name text NOT NULL DEFAULT '',
  phone text NOT NULL DEFAULT '',
  role text NOT NULL DEFAULT 'customer' CHECK (role IN ('customer','driver','dispatcher','admin')),
  account_status text NOT NULL DEFAULT 'active' CHECK (account_status IN ('active','suspended','pending')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE FUNCTION public.handle_new_auth_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.user_profiles (id, full_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data ->> 'full_name', ''));
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created_swifthaul
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_auth_user();

CREATE TABLE public.driver_profiles (
  user_id uuid PRIMARY KEY REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  phone text NOT NULL DEFAULT '',
  license_number text,
  license_expiry date,
  vehicle_type text CHECK (vehicle_type IN ('bike','bakkie','van','truck')),
  vehicle_registration text,
  verification_status text NOT NULL DEFAULT 'pending' CHECK (verification_status IN ('pending','approved','rejected','suspended')),
  availability_status text NOT NULL DEFAULT 'offline' CHECK (availability_status IN ('offline','available','on_delivery')),
  emergency_contact_name text,
  emergency_contact_phone text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.customer_bookings
  ADD COLUMN status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','assigned','accepted','picked_up','in_transit','delivered','failed','cancelled')),
  ADD COLUMN driver_user_id uuid REFERENCES public.driver_profiles(user_id),
  ADD COLUMN accepted_at timestamptz,
  ADD COLUMN picked_up_at timestamptz,
  ADD COLUMN in_transit_at timestamptz,
  ADD COLUMN failed_at timestamptz,
  ADD COLUMN failure_reason text,
  ADD COLUMN cancelled_at timestamptz;

CREATE INDEX customer_bookings_driver_status ON public.customer_bookings(driver_user_id,status,created_at DESC);
CREATE INDEX customer_bookings_status_created ON public.customer_bookings(status,created_at DESC);

CREATE TABLE public.delivery_status_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  waybill text NOT NULL REFERENCES public.customer_bookings(waybill) ON DELETE CASCADE,
  actor_user_id uuid REFERENCES auth.users(id),
  previous_status text,
  new_status text NOT NULL CHECK (new_status IN ('pending','assigned','accepted','picked_up','in_transit','delivered','failed','cancelled')),
  notes text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX delivery_status_events_waybill_created ON public.delivery_status_events(waybill,created_at);

CREATE TABLE public.proof_of_delivery (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  waybill text NOT NULL UNIQUE REFERENCES public.customer_bookings(waybill) ON DELETE CASCADE,
  driver_user_id uuid NOT NULL REFERENCES public.driver_profiles(user_id),
  storage_path text NOT NULL,
  recipient_name text,
  recipient_pin_verified_at timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
VALUES ('delivery-proof','delivery-proof',false,10485760,ARRAY['image/jpeg','image/png','image/webp']);

DO $$
DECLARE t record;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public'
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.tablename);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon, authenticated', t.tablename);
    EXECUTE format('GRANT ALL ON TABLE public.%I TO service_role', t.tablename);
  END LOOP;
END $$;
