-- Driver Premium insurance benefit limits and policy activation records.
-- These are benefit limits only; they do not create insurance cover without an insurer-issued policy.

create table if not exists public.driver_insurance_policies (
  id uuid primary key default gen_random_uuid(),
  driver_user_id uuid not null unique references auth.users(id) on delete restrict,
  insurer_name text,
  policy_reference text unique,
  status text not null default 'pending'
    check (status in ('pending','active','suspended','expired')),
  vehicle_cover_limit_cents bigint not null default 3000000
    check (vehicle_cover_limit_cents = 3000000),
  accidental_disability_cover_limit_cents bigint not null default 10000000
    check (accidental_disability_cover_limit_cents = 10000000),
  daily_accident_benefit_cents bigint not null default 100000
    check (daily_accident_benefit_cents = 100000),
  coverage_starts_at timestamptz,
  coverage_ends_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    status <> 'active' or (
      insurer_name is not null and char_length(trim(insurer_name)) > 1
      and policy_reference is not null and char_length(trim(policy_reference)) > 2
      and coverage_starts_at is not null and coverage_ends_at is not null
      and coverage_ends_at > coverage_starts_at
    )
  )
);

create index if not exists driver_insurance_policies_status_idx
  on public.driver_insurance_policies(status, coverage_ends_at);

alter table public.driver_insurance_policies enable row level security;
revoke all on public.driver_insurance_policies from public, anon, authenticated;
grant all on public.driver_insurance_policies to service_role;
