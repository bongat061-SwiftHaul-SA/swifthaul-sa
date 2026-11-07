-- Dispatch-bound insurance claim controls and private GPS evidence.
-- Daily accident support is capped at 5 days (R5,000) per accident claim.
alter table public.driver_insurance_policies
  add column if not exists daily_accident_benefit_max_days smallint not null default 5
    check (daily_accident_benefit_max_days = 5),
  add column if not exists dispatch_trip_only boolean not null default true
    check (dispatch_trip_only = true);

create table if not exists public.driver_insurance_trip_location_events (
  id bigint generated always as identity primary key,
  waybill text not null references public.customer_bookings(waybill) on delete cascade,
  driver_user_id uuid not null references auth.users(id) on delete cascade,
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  accuracy_m double precision check (accuracy_m is null or (accuracy_m >= 0 and accuracy_m <= 100000)),
  driver_was_online boolean not null default true check (driver_was_online = true),
  recorded_at timestamptz not null default now()
);
create index if not exists driver_insurance_trip_events_waybill_time_idx
  on public.driver_insurance_trip_location_events(waybill, recorded_at);
create index if not exists driver_insurance_trip_events_driver_time_idx
  on public.driver_insurance_trip_location_events(driver_user_id, recorded_at desc);
alter table public.driver_insurance_trip_location_events enable row level security;
revoke all on public.driver_insurance_trip_location_events from public, anon, authenticated;
grant all on public.driver_insurance_trip_location_events to service_role;

create table if not exists public.driver_insurance_claims (
  id uuid primary key default gen_random_uuid(),
  driver_user_id uuid not null references auth.users(id) on delete restrict,
  policy_id uuid not null references public.driver_insurance_policies(id) on delete restrict,
  waybill text not null references public.customer_bookings(waybill) on delete restrict,
  incident_at timestamptz not null,
  incident_type text not null check (incident_type in ('vehicle_accident','driver_injury','third_party_injury','vehicle_damage','other')),
  description text not null check (char_length(trim(description)) between 30 and 4000),
  requested_days smallint not null check (requested_days between 1 and 5),
  approved_days smallint check (approved_days is null or approved_days between 1 and 5),
  daily_benefit_cents bigint not null default 100000 check (daily_benefit_cents = 100000),
  requested_benefit_cents bigint generated always as (requested_days::bigint * daily_benefit_cents) stored,
  approved_benefit_cents bigint check (approved_benefit_cents is null or approved_benefit_cents between 0 and 500000),
  status text not null default 'submitted'
    check (status in ('submitted','under_review','insurer_approved','declined','paid')),
  route_compliance text not null default 'pending'
    check (route_compliance in ('pending','compliant','breach')),
  route_review_note text,
  insurer_name text,
  insurer_claim_reference text,
  insurer_decision_note text,
  payment_reference text,
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(driver_user_id, waybill), -- one accident claim per assigned dispatch; prevents splitting the five-day cap
  check (approved_days is null or (approved_benefit_cents is not null and approved_benefit_cents = approved_days::bigint * daily_benefit_cents)),
  check (status <> 'insurer_approved' or (route_compliance = 'compliant' and approved_days is not null and approved_benefit_cents is not null and insurer_claim_reference is not null)),
  check (status <> 'paid' or (status = 'paid' and payment_reference is not null and approved_benefit_cents is not null))
);
create index if not exists driver_insurance_claims_driver_created_idx
  on public.driver_insurance_claims(driver_user_id, created_at desc);
create index if not exists driver_insurance_claims_status_created_idx
  on public.driver_insurance_claims(status, created_at desc);
alter table public.driver_insurance_claims enable row level security;
revoke all on public.driver_insurance_claims from public, anon, authenticated;
grant all on public.driver_insurance_claims to service_role;

create table if not exists public.driver_insurance_claim_documents (
  id uuid primary key default gen_random_uuid(),
  claim_id uuid not null references public.driver_insurance_claims(id) on delete cascade,
  driver_user_id uuid not null references auth.users(id) on delete cascade,
  storage_path text not null unique,
  original_name text not null,
  content_type text not null check (content_type in ('application/pdf','image/jpeg','image/png','image/webp')),
  file_size_bytes bigint not null check (file_size_bytes between 1 and 10485760),
  created_at timestamptz not null default now()
);
create index if not exists driver_insurance_claim_documents_claim_idx
  on public.driver_insurance_claim_documents(claim_id, created_at);
alter table public.driver_insurance_claim_documents enable row level security;
revoke all on public.driver_insurance_claim_documents from public, anon, authenticated;
grant all on public.driver_insurance_claim_documents to service_role;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('driver-insurance-claims','driver-insurance-claims',false,10485760,array['application/pdf','image/jpeg','image/png','image/webp'])
on conflict(id) do update set public=false,file_size_limit=10485760,allowed_mime_types=excluded.allowed_mime_types;
