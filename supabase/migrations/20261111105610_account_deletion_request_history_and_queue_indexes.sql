alter table public.account_deletion_requests
  drop constraint if exists account_deletion_requests_user_id_app_type_status_key;

create unique index if not exists account_deletion_requests_one_open_per_app_idx
  on public.account_deletion_requests (user_id, app_type)
  where status in ('pending', 'reviewing');

create index if not exists account_deletion_requests_queue_idx
  on public.account_deletion_requests (status, requested_at)
  where status in ('pending', 'reviewing');

create index if not exists account_deletion_requests_reviewed_by_idx
  on public.account_deletion_requests (reviewed_by)
  where reviewed_by is not null;
