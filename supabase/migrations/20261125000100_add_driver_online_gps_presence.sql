-- Private, short-lived GPS presence for approved drivers who opt in while online.
create table if not exists public.driver_online_locations (
  driver_user_id uuid primary key references auth.users(id) on delete cascade,
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  accuracy_m double precision check (accuracy_m is null or (accuracy_m >= 0 and accuracy_m <= 100000)),
  updated_at timestamptz not null default now()
);
create index if not exists driver_online_locations_updated_at_idx
  on public.driver_online_locations (updated_at desc);
alter table public.driver_online_locations enable row level security;
revoke all on table public.driver_online_locations from anon, authenticated;
grant all on table public.driver_online_locations to service_role;

create or replace function public.clear_driver_online_location_on_offline()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.is_online is distinct from old.is_online and new.is_online = false then
    delete from public.driver_online_locations where driver_user_id = new.user_id;
  end if;
  return new;
end;
$$;
drop trigger if exists clear_driver_online_location_on_offline on public.driver_profiles;
create trigger clear_driver_online_location_on_offline
after update of is_online on public.driver_profiles
for each row execute function public.clear_driver_online_location_on_offline();

-- Persist the pickup-approach quote and explicit customer approval.
alter table public.delivery_quotes
  add column if not exists pickup_approach_driver_user_id uuid references auth.users(id) on delete set null,
  add column if not exists pickup_approach_distance_meters double precision,
  add column if not exists pickup_approach_fee numeric(12,2) not null default 0,
  add column if not exists pickup_approach_quoted_at timestamptz;
alter table public.customer_bookings
  add column if not exists pickup_approach_driver_user_id uuid references auth.users(id) on delete set null,
  add column if not exists pickup_approach_distance_meters double precision,
  add column if not exists pickup_approach_fee numeric(12,2) not null default 0,
  add column if not exists pickup_approach_approved boolean not null default false;
