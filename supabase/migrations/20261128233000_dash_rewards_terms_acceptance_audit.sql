create table if not exists public.customer_dash_reward_terms_acceptances (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 action text not null check (action in ('voucher_claim','cashout_request')),
 terms_version text not null,
 accepted_at timestamptz not null default now()
);
create index if not exists customer_dash_reward_terms_acceptances_user_idx
 on public.customer_dash_reward_terms_acceptances(user_id, accepted_at desc);
alter table public.customer_dash_reward_terms_acceptances enable row level security;
revoke all on public.customer_dash_reward_terms_acceptances from anon, authenticated;
grant all on public.customer_dash_reward_terms_acceptances to service_role;
