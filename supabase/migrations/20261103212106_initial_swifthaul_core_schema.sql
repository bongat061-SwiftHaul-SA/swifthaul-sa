-- SwiftHaul SA core schema migrated from the existing Netlify/Postgres migrations.
-- This is a fresh Supabase database baseline. Existing production data is NOT copied here.
-- Access is intentionally server-only until authenticated Edge Functions and policies are deployed.

CREATE TABLE public.customer_bookings (
  waybill text PRIMARY KEY,
  owner_hash text NOT NULL,
  pin text NOT NULL,
  pickup text NOT NULL,
  dropoff text NOT NULL,
  recipient text NOT NULL,
  vehicle text NOT NULL CHECK (vehicle IN ('bike','bakkie','van','truck')),
  price numeric(20,2) NOT NULL CHECK (price > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  distance_meters double precision CHECK (distance_meters >= 0 AND distance_meters < 'Infinity'::float8),
  price_band integer CHECK (price_band >= 0),
  quote_id uuid UNIQUE,
  scheduled_at timestamptz,
  return_address text,
  return_at timestamptz,
  load jsonb,
  distance_fee numeric(20,2),
  payment_method text NOT NULL DEFAULT 'dispatch' CHECK (payment_method IN ('cash','dispatch')),
  counter_offer numeric(20,2) CHECK (counter_offer > 0),
  counter_offer_status text NOT NULL DEFAULT 'none' CHECK (counter_offer_status IN ('none','pending','accepted','declined')),
  assigned_driver text,
  completed_at timestamptz,
  paid_at timestamptz,
  rewards_at timestamptz,
  pin_attempts integer NOT NULL DEFAULT 0,
  pin_locked_until timestamptz,
  payment_source text CHECK (payment_source IN ('cash','wallet','paystack','pay_later')),
  wallet_refund_used bigint NOT NULL DEFAULT 0,
  wallet_promo_used bigint NOT NULL DEFAULT 0,
  refunded_at timestamptz,
  original_price numeric(20,2),
  CONSTRAINT counter_offer_consistency CHECK ((counter_offer IS NULL AND counter_offer_status='none') OR (counter_offer IS NOT NULL AND counter_offer_status<>'none')),
  CONSTRAINT cash_distance_eligibility CHECK (payment_method <> 'cash' OR (distance_meters IS NOT NULL AND distance_meters < 12000)),
  CONSTRAINT counter_offer_distance_eligibility CHECK (counter_offer IS NULL OR (distance_meters IS NOT NULL AND distance_meters < 24000))
);

CREATE TABLE public.delivery_quotes (
  id uuid PRIMARY KEY,
  owner_hash text NOT NULL,
  pickup text NOT NULL,
  dropoff text NOT NULL,
  vehicle text NOT NULL CHECK (vehicle IN ('bike','van','truck')),
  distance_meters double precision NOT NULL CHECK (distance_meters >= 0 AND distance_meters < 'Infinity'::float8),
  price_band integer NOT NULL CHECK (price_band >= 0),
  price numeric(20,2) NOT NULL CHECK (price > 0 AND price <= 9007199254740991),
  route jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '15 minutes'),
  load jsonb,
  distance_fee numeric(20,2)
);
ALTER TABLE public.customer_bookings ADD CONSTRAINT customer_bookings_quote_id_fkey
  FOREIGN KEY (quote_id) REFERENCES public.delivery_quotes(id);
CREATE INDEX customer_bookings_owner_created ON public.customer_bookings(owner_hash,created_at DESC);
CREATE INDEX delivery_quotes_owner_expires ON public.delivery_quotes(owner_hash,expires_at);

CREATE TABLE public.customer_profiles (
  owner_hash text PRIMARY KEY,
  full_name text NOT NULL DEFAULT '',
  phone text NOT NULL DEFAULT '',
  details text NOT NULL DEFAULT '',
  bank_name text NOT NULL DEFAULT '',
  account_holder text NOT NULL DEFAULT '',
  account_number text NOT NULL DEFAULT '',
  branch_code text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.customer_deletions (
  owner_hash text PRIMARY KEY,
  requested_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.wallet_accounts (
  owner_hash text PRIMARY KEY,
  referral_code text NOT NULL UNIQUE,
  referred_by text REFERENCES public.wallet_accounts(owner_hash),
  refund_cents bigint NOT NULL DEFAULT 0 CHECK(refund_cents >= 0),
  promo_cents bigint NOT NULL DEFAULT 0 CHECK(promo_cents >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  promo_debt_cents bigint NOT NULL DEFAULT 0 CHECK(promo_debt_cents >= 0)
);
CREATE TABLE public.wallet_ledger (
  id uuid PRIMARY KEY,
  owner_hash text NOT NULL REFERENCES public.wallet_accounts(owner_hash),
  event_key text NOT NULL UNIQUE,
  refund_delta bigint NOT NULL DEFAULT 0,
  promo_delta bigint NOT NULL DEFAULT 0,
  description text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  promo_debt_delta bigint NOT NULL DEFAULT 0
);
CREATE INDEX wallet_ledger_owner ON public.wallet_ledger(owner_hash,created_at DESC);
CREATE TABLE public.wallet_loans (
  id uuid PRIMARY KEY,
  owner_hash text NOT NULL REFERENCES public.wallet_accounts(owner_hash),
  waybill text NOT NULL UNIQUE,
  amount_cents bigint NOT NULL CHECK(amount_cents > 0 AND amount_cents <= 50000),
  due_at timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.wallet_payments (
  reference text PRIMARY KEY,
  owner_hash text NOT NULL REFERENCES public.wallet_accounts(owner_hash),
  waybill text,
  loan_id uuid REFERENCES public.wallet_loans(id),
  amount_cents bigint NOT NULL CHECK(amount_cents > 0),
  state text NOT NULL DEFAULT 'created' CHECK(state IN ('created','success','superseded')),
  checkout_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((waybill IS NULL) <> (loan_id IS NULL))
);
CREATE UNIQUE INDEX wallet_active_booking_payment ON public.wallet_payments(waybill) WHERE state='created' AND waybill IS NOT NULL;
CREATE UNIQUE INDEX wallet_active_loan_payment ON public.wallet_payments(loan_id) WHERE state='created' AND loan_id IS NOT NULL;
CREATE TABLE public.wallet_withdrawals (
  reference text PRIMARY KEY,
  owner_hash text NOT NULL REFERENCES public.wallet_accounts(owner_hash),
  gross_cents bigint NOT NULL CHECK(gross_cents > 0),
  fee_cents bigint NOT NULL CHECK(fee_cents >= 0),
  net_cents bigint NOT NULL CHECK(net_cents > 0),
  speed text NOT NULL CHECK(speed IN ('instant','standard')),
  state text NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','processing','paid','failed')),
  recipient_code text NOT NULL,
  available_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (net_cents + fee_cents = gross_cents)
);

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
