-- Driver Premium insurance: staging-first policy, claim and dispatch GPS evidence foundation.
create table if not exists public.driver_insurance_policies (
  id uuid primary key default gen_random_uuid(),
  driver_user_id uuid not null unique references public.driver_profiles(user_id) on delete restrict,
  status text not null default 'pending' check (status in ('pending','active','suspended','expired')),
  insurer_name text,
  policy_reference text,
  vehicle_cover_limit_cents bigint not null default 3000000 check (vehicle_cover_limit_cents = 3000000),
  accidental_disability_cover_limit_cents bigint not null default 10000000 check (accidental_disability_cover_limit_cents = 10000000),
  daily_accident_benefit_cents bigint not null default 100000 check (daily_accident_benefit_cents = 100000),
  max_daily_benefit_days integer not null default 5 check (max_daily_benefit_days = 5),
  coverage_starts_at timestamptz,
  coverage_ends_at timestamptz,
  activated_by uuid references public.user_profiles(id),
  activated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status <> 'active' or (nullif(trim(insurer_name),'') is not null and nullif(trim(policy_reference),'') is not null and coverage_starts_at is not null and coverage_ends_at > coverage_starts_at and activated_by is not null and activated_at is not null))
);
create table if not exists public.driver_insurance_claims (
  id uuid primary key default gen_random_uuid(),
  driver_user_id uuid not null references public.driver_profiles(user_id) on delete restrict,
  policy_id uuid not null references public.driver_insurance_policies(id) on delete restrict,
  waybill text not null references public.customer_bookings(waybill) on delete restrict,
  incident_at timestamptz not null,
  incident_type text not null check (incident_type in ('vehicle_accident','driver_injury','third_party_injury','vehicle_damage','other')),
  description text not null check (length(trim(description)) between 30 and 4000),
  requested_days integer not null check (requested_days between 1 and 5),
  requested_benefit_cents bigint not null check (requested_benefit_cents between 100000 and 500000),
  status text not null default 'submitted' check (status in ('submitted','under_review','insurer_approved','declined','paid')),
  route_compliance text not null default 'pending' check (route_compliance in ('pending','compliant','breach')),
  route_review_note text,
  insurer_name text,
  insurer_claim_reference text,
  insurer_decision_note text,
  approved_days integer check (approved_days between 1 and 5),
  approved_benefit_cents bigint,
  settlement_reference text,
  submitted_at timestamptz not null default now(),
  reviewed_by uuid references public.user_profiles(id),
  reviewed_at timestamptz,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  unique(driver_user_id,waybill,incident_at)
);
create table if not exists public.driver_insurance_claim_documents (
  id uuid primary key default gen_random_uuid(),
  claim_id uuid not null references public.driver_insurance_claims(id) on delete cascade,
  storage_path text not null unique,
  original_name text not null,
  content_type text not null,
  size_bytes bigint not null check (size_bytes between 1 and 10485760),
  created_at timestamptz not null default now()
);
create table if not exists public.driver_insurance_gps_points (
  id bigint generated always as identity primary key,
  driver_user_id uuid not null references public.driver_profiles(user_id) on delete cascade,
  waybill text not null references public.customer_bookings(waybill) on delete cascade,
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  accuracy_m double precision check (accuracy_m is null or accuracy_m between 0 and 10000),
  recorded_at timestamptz not null default now()
);
create index if not exists driver_insurance_claims_driver_created_idx on public.driver_insurance_claims(driver_user_id,created_at desc);
create index if not exists driver_insurance_claims_status_created_idx on public.driver_insurance_claims(status,created_at desc);
create index if not exists driver_insurance_gps_waybill_time_idx on public.driver_insurance_gps_points(waybill,recorded_at);
create index if not exists driver_insurance_gps_driver_time_idx on public.driver_insurance_gps_points(driver_user_id,recorded_at desc);
alter table public.driver_insurance_policies enable row level security;
alter table public.driver_insurance_claims enable row level security;
alter table public.driver_insurance_claim_documents enable row level security;
alter table public.driver_insurance_gps_points enable row level security;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('driver-insurance-claims','driver-insurance-claims',false,10485760,array['application/pdf','image/jpeg','image/png','image/webp'])
on conflict(id) do update set public=false,file_size_limit=10485760,allowed_mime_types=excluded.allowed_mime_types;
