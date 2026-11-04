alter table public.driver_profiles add column if not exists is_online boolean not null default false;
alter table public.driver_profiles add column if not exists online_updated_at timestamptz;
