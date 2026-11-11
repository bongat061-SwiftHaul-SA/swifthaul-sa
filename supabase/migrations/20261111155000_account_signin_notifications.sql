alter table public.customer_welcome_notifications add column if not exists admin_email_sent_at timestamptz;
create table if not exists public.account_signin_notifications (
 user_id uuid not null references auth.users(id) on delete cascade,
 session_id uuid not null,
 email_sent_at timestamptz,
 created_at timestamptz not null default now(),
 primary key(user_id,session_id)
);
alter table public.account_signin_notifications enable row level security;
revoke all on public.account_signin_notifications from anon,authenticated;
grant select,insert,update,delete on public.account_signin_notifications to service_role;