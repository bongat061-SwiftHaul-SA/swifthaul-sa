-- Self-service account profile pictures and deletion requests for Customer and Driver.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('driver-profile-photos','driver-profile-photos',false,2097152,array['image/jpeg','image/png','image/webp'])
on conflict(id) do update set public=false,file_size_limit=2097152,allowed_mime_types=excluded.allowed_mime_types;

create table if not exists public.account_deletion_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  app_type text not null check (app_type in ('customer','driver')),
  reason text,
  status text not null default 'pending' check (status in ('pending','reviewing','approved','rejected','cancelled')),
  requested_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id),
  unique(user_id, app_type, status)
);
alter table public.account_deletion_requests enable row level security;
revoke all on public.account_deletion_requests from public, anon, authenticated;
grant select,insert,update,delete on public.account_deletion_requests to service_role;
