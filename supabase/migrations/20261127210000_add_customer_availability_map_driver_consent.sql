alter table public.driver_profiles
  add column if not exists customer_availability_map_opt_in boolean not null default false,
  add column if not exists customer_availability_map_opt_in_at timestamptz;

comment on column public.driver_profiles.customer_availability_map_opt_in is
  'Explicit driver consent to display an approximate, aggregated location on the customer pre-booking availability map. This is separate from bonus_availability_opt_in.';
comment on column public.driver_profiles.customer_availability_map_opt_in_at is
  'Timestamp of the latest affirmative customer availability map consent. Cleared when consent is revoked.';

create index if not exists driver_profiles_customer_availability_map_idx
  on public.driver_profiles (verification_status, is_online, customer_availability_map_opt_in)
  where verification_status = 'approved' and is_online = true and customer_availability_map_opt_in = true;