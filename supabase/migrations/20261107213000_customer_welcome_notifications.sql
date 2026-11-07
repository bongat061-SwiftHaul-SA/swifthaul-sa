create table if not exists public.customer_welcome_notifications (
 customer_user_id uuid primary key references auth.users(id) on delete cascade,
 welcome_email_sent_at timestamptz,
 updated_at timestamptz not null default now()
);
alter table public.customer_welcome_notifications enable row level security;
revoke all on public.customer_welcome_notifications from anon,authenticated;
grant select,insert,update,delete on public.customer_welcome_notifications to service_role;
