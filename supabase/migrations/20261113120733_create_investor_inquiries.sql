create table if not exists public.investor_inquiries (
 id uuid primary key default gen_random_uuid(),
 full_name text not null check (char_length(full_name) between 2 and 120),
 email text not null check (char_length(email) between 3 and 254),
 phone text not null check (char_length(phone) between 7 and 32),
 track text not null check (track in ('crowdfunding','fleet_asset','angel_seed')),
 indicative_range_zar text,
 message text,
 popia_consented boolean not null default false check (popia_consented = true),
 status text not null default 'new' check (status in ('new','reviewing','contacted','closed')),
 admin_notes text,
 created_at timestamptz not null default now()
);
create index if not exists investor_inquiries_created_at_idx on public.investor_inquiries(created_at desc);
alter table public.investor_inquiries enable row level security;
revoke all on public.investor_inquiries from anon, authenticated;
grant all on public.investor_inquiries to service_role;
