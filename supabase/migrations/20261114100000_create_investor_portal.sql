-- Investor portal: private, invitation-only investor records and published company updates.
create table if not exists public.investor_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 2 and 160),
  shares_owned numeric(20,4) not null default 0 check (shares_owned >= 0),
  ownership_percentage numeric(12,6) not null default 0 check (ownership_percentage >= 0 and ownership_percentage <= 100),
  investment_amount_zar numeric(16,2) not null default 0 check (investment_amount_zar >= 0),
  share_class text,
  status text not null default 'active' check (status in ('active','suspended','closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.investor_company_metrics (
  id uuid primary key default gen_random_uuid(),
  metric_key text not null,
  metric_label text not null,
  metric_value numeric(20,4) not null,
  value_format text not null default 'number' check (value_format in ('number','currency','percent')),
  period_label text,
  display_order integer not null default 100,
  is_published boolean not null default false,
  published_at timestamptz,
  created_at timestamptz not null default now()
);
create table if not exists public.investor_updates (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 3 and 180),
  body text not null check (char_length(body) between 1 and 12000),
  category text not null default 'company' check (category in ('company','financial','operations','shareholder','notice')),
  is_published boolean not null default false,
  published_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists investor_metrics_published_idx on public.investor_company_metrics(is_published,display_order);
create index if not exists investor_updates_published_idx on public.investor_updates(is_published,published_at desc);
alter table public.investor_profiles enable row level security;
alter table public.investor_company_metrics enable row level security;
alter table public.investor_updates enable row level security;
revoke all on public.investor_profiles, public.investor_company_metrics, public.investor_updates from anon;
revoke all on public.investor_profiles, public.investor_company_metrics, public.investor_updates from authenticated;
grant select on public.investor_profiles, public.investor_company_metrics, public.investor_updates to authenticated;
drop policy if exists "Investors can read their own profile" on public.investor_profiles;
create policy "Investors can read their own profile" on public.investor_profiles for select to authenticated using (user_id = (select auth.uid()) and status = 'active');
drop policy if exists "Active investors can read published metrics" on public.investor_company_metrics;
create policy "Active investors can read published metrics" on public.investor_company_metrics for select to authenticated using (is_published = true and exists (select 1 from public.investor_profiles p where p.user_id = (select auth.uid()) and p.status = 'active'));
drop policy if exists "Active investors can read published updates" on public.investor_updates;
create policy "Active investors can read published updates" on public.investor_updates for select to authenticated using (is_published = true and exists (select 1 from public.investor_profiles p where p.user_id = (select auth.uid()) and p.status = 'active'));
