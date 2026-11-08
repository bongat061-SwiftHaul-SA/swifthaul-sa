-- Customer Goods-in-Transit insurance foundation.
-- This is deliberately non-activatable until an insurer and binding policy terms are approved.
create table if not exists public.customer_cargo_insurance_products (
  id uuid primary key default gen_random_uuid(),
  product_name text not null default 'Customer Goods-in-Transit',
  status text not null default 'draft' check (status in ('draft','available','withdrawn')),
  insurer_name text,
  insurer_product_reference text,
  policy_wording_url text,
  certificate_template_reference text,
  currency_code text not null default 'ZAR' check (currency_code = 'ZAR'),
  premium_cents bigint check (premium_cents is null or premium_cents >= 0),
  minimum_declared_value_cents bigint check (minimum_declared_value_cents is null or minimum_declared_value_cents >= 0),
  maximum_declared_value_cents bigint check (maximum_declared_value_cents is null or maximum_declared_value_cents >= 0),
  maximum_cover_cents bigint check (maximum_cover_cents is null or maximum_cover_cents >= 0),
  exclusions jsonb not null default '[]'::jsonb check (jsonb_typeof(exclusions) = 'array'),
  covered_events jsonb not null default '[]'::jsonb check (jsonb_typeof(covered_events) = 'array'),
  claims_instructions text,
  effective_from timestamptz,
  effective_until timestamptz,
  approved_by uuid references public.user_profiles(id),
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (maximum_declared_value_cents is null or minimum_declared_value_cents is null or maximum_declared_value_cents >= minimum_declared_value_cents),
  check (status <> 'available' or (
    nullif(trim(insurer_name),'') is not null
    and nullif(trim(insurer_product_reference),'') is not null
    and nullif(trim(policy_wording_url),'') is not null
    and premium_cents is not null
    and maximum_cover_cents is not null
    and effective_from is not null
    and (effective_until is null or effective_until > effective_from)
    and approved_by is not null
    and approved_at is not null
    and jsonb_array_length(covered_events) > 0
    and jsonb_array_length(exclusions) > 0
  ))
);

create table if not exists public.customer_cargo_insurance_policies (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.customer_cargo_insurance_products(id) on delete restrict,
  customer_user_id uuid not null references auth.users(id) on delete restrict,
  waybill text not null unique references public.customer_bookings(waybill) on delete restrict,
  status text not null default 'pending' check (status in ('pending','active','suspended','expired','claim_opened','claimed','cancelled')),
  declared_goods_description text not null check (length(trim(declared_goods_description)) between 3 and 2000),
  declared_value_cents bigint not null check (declared_value_cents > 0),
  premium_paid_cents bigint not null check (premium_paid_cents >= 0),
  currency_code text not null default 'ZAR' check (currency_code = 'ZAR'),
  insurer_name text,
  insurer_policy_reference text,
  certificate_reference text,
  cover_limit_cents bigint check (cover_limit_cents is null or cover_limit_cents >= 0),
  coverage_starts_at timestamptz,
  coverage_ends_at timestamptz,
  terms_version text,
  terms_accepted_at timestamptz,
  activated_by uuid references public.user_profiles(id),
  activated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status <> 'active' or (
    nullif(trim(insurer_name),'') is not null
    and nullif(trim(insurer_policy_reference),'') is not null
    and nullif(trim(certificate_reference),'') is not null
    and cover_limit_cents is not null
    and coverage_starts_at is not null
    and coverage_ends_at > coverage_starts_at
    and nullif(trim(terms_version),'') is not null
    and terms_accepted_at is not null
    and activated_by is not null
    and activated_at is not null
  ))
);

create table if not exists public.customer_cargo_insurance_claims (
  id uuid primary key default gen_random_uuid(),
  policy_id uuid not null references public.customer_cargo_insurance_policies(id) on delete restrict,
  customer_user_id uuid not null references auth.users(id) on delete restrict,
  waybill text not null references public.customer_bookings(waybill) on delete restrict,
  incident_at timestamptz not null,
  incident_type text not null check (incident_type in ('loss','theft','damage','other')),
  description text not null check (length(trim(description)) between 30 and 5000),
  claimed_amount_cents bigint not null check (claimed_amount_cents > 0),
  status text not null default 'submitted' check (status in ('submitted','under_review','referred_to_insurer','insurer_approved','declined','settled')),
  insurer_claim_reference text,
  insurer_decision text check (insurer_decision is null or insurer_decision in ('approved','declined','pending')),
  insurer_decision_note text,
  approved_amount_cents bigint check (approved_amount_cents is null or approved_amount_cents >= 0),
  settlement_reference text,
  submitted_at timestamptz not null default now(),
  reviewed_by uuid references public.user_profiles(id),
  reviewed_at timestamptz,
  settled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(policy_id,incident_at)
);

create table if not exists public.customer_cargo_insurance_claim_documents (
  id uuid primary key default gen_random_uuid(),
  claim_id uuid not null references public.customer_cargo_insurance_claims(id) on delete cascade,
  customer_user_id uuid not null references auth.users(id) on delete restrict,
  storage_path text not null unique,
  original_name text not null,
  content_type text not null,
  file_size_bytes bigint not null check (file_size_bytes between 1 and 10485760),
  created_at timestamptz not null default now()
);

create index if not exists customer_cargo_insurance_policies_customer_idx
  on public.customer_cargo_insurance_policies(customer_user_id,created_at desc);
create index if not exists customer_cargo_insurance_claims_status_idx
  on public.customer_cargo_insurance_claims(status,created_at desc);
create index if not exists customer_cargo_insurance_claims_customer_idx
  on public.customer_cargo_insurance_claims(customer_user_id,created_at desc);

alter table public.customer_cargo_insurance_products enable row level security;
alter table public.customer_cargo_insurance_policies enable row level security;
alter table public.customer_cargo_insurance_claims enable row level security;
alter table public.customer_cargo_insurance_claim_documents enable row level security;

-- No browser-role table access. Future access must be via narrowly authenticated Edge Functions.
revoke all privileges on table public.customer_cargo_insurance_products,
  public.customer_cargo_insurance_policies,
  public.customer_cargo_insurance_claims,
  public.customer_cargo_insurance_claim_documents
from anon, authenticated;
grant all privileges on table public.customer_cargo_insurance_products,
  public.customer_cargo_insurance_policies,
  public.customer_cargo_insurance_claims,
  public.customer_cargo_insurance_claim_documents
to service_role;
