create table if not exists public.web_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  constraint web_push_endpoint_https check (endpoint like 'https://%'),
  constraint web_push_key_lengths check (length(p256dh) between 20 and 200 and length(auth) between 8 and 100)
);
create index if not exists web_push_subscriptions_user_id_idx on public.web_push_subscriptions(user_id);
alter table public.web_push_subscriptions enable row level security;
drop policy if exists "Users manage their own web push subscriptions" on public.web_push_subscriptions;
create policy "Users manage their own web push subscriptions"
  on public.web_push_subscriptions for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
grant select, insert, update, delete on public.web_push_subscriptions to authenticated;

create or replace function public.get_swifthaul_vapid_config()
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select case when auth.role() = 'service_role' then
    jsonb_build_object(
      'public_key', (select decrypted_secret from vault.decrypted_secrets where name = 'swifthaul_vapid_public_key' limit 1),
      'private_key', (select decrypted_secret from vault.decrypted_secrets where name = 'swifthaul_vapid_private_key' limit 1)
    )
  else null end;
$$;
revoke all on function public.get_swifthaul_vapid_config() from public, anon, authenticated;
grant execute on function public.get_swifthaul_vapid_config() to service_role;
