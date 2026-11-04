create table if not exists public.driver_memberships (
 id uuid primary key default gen_random_uuid(),
 driver_user_id uuid not null references auth.users(id) on delete restrict,
 plan text not null check (plan in ('monthly','yearly')),
 amount_cents bigint not null check ((plan='monthly' and amount_cents=25000) or (plan='yearly' and amount_cents=180000)),
 status text not null default 'pending' check (status in ('pending','active','cancelled','expired','payment_failed')),
 starts_at timestamptz, ends_at timestamptz, auto_renew boolean not null default false,
 provider text not null default 'payfast_sandbox', provider_payment_id text unique,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 check ((status='active' and starts_at is not null and ends_at is not null) or status<>'active')
);
create index if not exists driver_memberships_driver_period_idx on public.driver_memberships(driver_user_id,status,ends_at desc);
create unique index if not exists driver_memberships_one_active_per_driver on public.driver_memberships(driver_user_id) where status='active';
create table if not exists public.driver_membership_revenue_ledger (
 id uuid primary key default gen_random_uuid(), event_key text not null unique,
 driver_user_id uuid references auth.users(id) on delete restrict,
 membership_id uuid references public.driver_memberships(id) on delete restrict,
 event_type text not null check (event_type in ('subscription_paid','subscription_refund','admin_adjustment')),
 amount_cents bigint not null check (amount_cents<>0), provider_reference text,
 description text not null check (char_length(description) between 3 and 500), created_at timestamptz not null default now()
);
create table if not exists public.driver_reward_ledger (
 id uuid primary key default gen_random_uuid(), driver_user_id uuid not null references auth.users(id) on delete restrict,
 event_key text not null unique,
 event_type text not null check (event_type in ('fuel_rebate','milestone_bonus','availability_bonus','admin_adjustment')),
 amount_cents bigint not null check (amount_cents<>0), waybill text references public.customer_bookings(waybill) on delete restrict,
 period_start date, description text not null check (char_length(description) between 3 and 500), created_at timestamptz not null default now()
);
create index if not exists driver_reward_ledger_driver_period_idx on public.driver_reward_ledger(driver_user_id,created_at desc);
create index if not exists driver_reward_ledger_type_period_idx on public.driver_reward_ledger(event_type,created_at desc);
create table if not exists public.driver_micro_loan_applications (
 id uuid primary key default gen_random_uuid(), driver_user_id uuid not null references auth.users(id) on delete restrict,
 requested_amount_cents bigint not null check (requested_amount_cents between 10000 and 150000),
 eligible_amount_cents bigint not null check (eligible_amount_cents between 0 and 150000),
 status text not null default 'submitted' check (status in ('submitted','under_review','approved','rejected','withdrawn')),
 compliance_hold boolean not null default true, admin_reference text, reviewed_by uuid references auth.users(id),
 reviewed_at timestamptz, created_at timestamptz not null default now()
);
create index if not exists driver_micro_loan_app_driver_idx on public.driver_micro_loan_applications(driver_user_id,created_at desc);
create table if not exists public.driver_micro_loans (
 id uuid primary key default gen_random_uuid(), application_id uuid not null unique references public.driver_micro_loan_applications(id) on delete restrict,
 driver_user_id uuid not null references auth.users(id) on delete restrict,
 principal_cents bigint not null check (principal_cents between 10000 and 150000),
 balance_cents bigint not null check (balance_cents between 0 and 150000),
 status text not null default 'compliance_hold' check (status in ('compliance_hold','approved','active','repaid','defaulted','cancelled')),
 approved_by uuid references auth.users(id), approved_at timestamptz, disbursed_at timestamptz, created_at timestamptz not null default now()
);
create index if not exists driver_micro_loans_driver_status_idx on public.driver_micro_loans(driver_user_id,status);
create table if not exists public.driver_finance_settings (
 id boolean primary key default true check (id),
 monthly_subscription_cents bigint not null default 25000 check (monthly_subscription_cents=25000),
 yearly_subscription_cents bigint not null default 180000 check (yearly_subscription_cents=180000),
 fuel_rebate_per_delivery_cents bigint not null default 1500 check (fuel_rebate_per_delivery_cents=1500),
 fuel_rebate_monthly_cap_cents bigint not null default 45000 check (fuel_rebate_monthly_cap_cents=45000),
 milestone_bonus_cents bigint not null default 50000 check (milestone_bonus_cents=50000),
 milestone_delivery_threshold integer not null default 10 check (milestone_delivery_threshold=10),
 micro_loan_min_tenure_days integer not null default 45 check (micro_loan_min_tenure_days=45),
 micro_loan_min_deliveries integer not null default 15 check (micro_loan_min_deliveries=15),
 micro_loan_earnings_window_days integer not null default 14 check (micro_loan_earnings_window_days=14),
 micro_loan_advance_rate numeric(5,4) not null default 0.25 check (micro_loan_advance_rate=0.25),
 micro_loan_repayment_rate numeric(5,4) not null default 0.15 check (micro_loan_repayment_rate=0.15),
 micro_loan_max_cents bigint not null default 150000 check (micro_loan_max_cents=150000),
 micro_loans_enabled boolean not null default false, updated_at timestamptz not null default now()
);
insert into public.driver_finance_settings(id) values(true) on conflict(id) do nothing;
alter table public.driver_memberships enable row level security;
alter table public.driver_membership_revenue_ledger enable row level security;
alter table public.driver_reward_ledger enable row level security;
alter table public.driver_micro_loan_applications enable row level security;
alter table public.driver_micro_loans enable row level security;
alter table public.driver_finance_settings enable row level security;
revoke all on public.driver_memberships,public.driver_membership_revenue_ledger,public.driver_reward_ledger,public.driver_micro_loan_applications,public.driver_micro_loans,public.driver_finance_settings from public,anon,authenticated;
grant all on public.driver_memberships,public.driver_membership_revenue_ledger,public.driver_reward_ledger,public.driver_micro_loan_applications,public.driver_micro_loans,public.driver_finance_settings to service_role;
create or replace function public.driver_premium_active(p_driver_id uuid,p_at timestamptz default now())
returns boolean language sql stable security invoker set search_path=public as $$
 select exists(select 1 from public.driver_memberships m where m.driver_user_id=p_driver_id and m.status='active' and m.starts_at<=p_at and m.ends_at>p_at);
$$;
revoke all on function public.driver_premium_active(uuid,timestamptz) from public,anon,authenticated;
grant execute on function public.driver_premium_active(uuid,timestamptz) to service_role;
