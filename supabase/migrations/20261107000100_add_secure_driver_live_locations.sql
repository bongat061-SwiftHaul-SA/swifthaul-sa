-- Live driver coordinates are private operational data. All reads and writes go
-- through the authenticated driver-location Edge Function using service_role.
create table if not exists public.driver_live_locations (
  waybill text primary key references public.customer_bookings(waybill) on delete cascade,
  driver_user_id uuid not null references auth.users(id) on delete cascade,
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  accuracy_m double precision check (accuracy_m is null or (accuracy_m >= 0 and accuracy_m <= 100000)),
  updated_at timestamptz not null default now()
);

create index if not exists driver_live_locations_driver_updated_idx
  on public.driver_live_locations (driver_user_id, updated_at desc);

alter table public.driver_live_locations enable row level security;
revoke all on table public.driver_live_locations from anon, authenticated;
grant all on table public.driver_live_locations to service_role;

create or replace function public.clear_driver_live_location_on_booking_change()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status in ('delivered', 'failed', 'cancelled')
     or new.driver_user_id is distinct from old.driver_user_id then
    delete from public.driver_live_locations where waybill = new.waybill;
  end if;
  return new;
end;
$$;

drop trigger if exists clear_driver_live_location_on_booking_change on public.customer_bookings;
create trigger clear_driver_live_location_on_booking_change
after update of status, driver_user_id on public.customer_bookings
for each row execute function public.clear_driver_live_location_on_booking_change();
