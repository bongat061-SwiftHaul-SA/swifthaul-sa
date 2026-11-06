-- Persistent multi-stop dispatch routes.
-- Applied only after review; this file is committed to the development branch.
create table if not exists public.dispatch_routes (
  id uuid primary key default gen_random_uuid(),
  driver_user_id uuid not null references public.driver_profiles(user_id) on delete restrict,
  created_by uuid not null references auth.users(id) on delete restrict,
  status text not null default 'assigned'
    check (status in ('assigned','in_progress','completed','cancelled')),
  route_distance_meters double precision
    check (route_distance_meters is null or (route_distance_meters >= 0 and route_distance_meters < 'Infinity'::double precision)),
  estimated_duration_seconds integer
    check (estimated_duration_seconds is null or estimated_duration_seconds >= 0),
  route_geometry jsonb,
  routing_provider text,
  route_calculated_at timestamptz,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz
);

create table if not exists public.dispatch_route_stops (
  id uuid primary key default gen_random_uuid(),
  route_id uuid not null references public.dispatch_routes(id) on delete cascade,
  waybill text not null references public.customer_bookings(waybill) on delete restrict,
  sequence_no integer not null check (sequence_no between 1 and 60),
  stop_type text not null check (stop_type in ('pickup','dropoff')),
  status text not null default 'pending' check (status in ('pending','completed')),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (route_id, sequence_no),
  unique (route_id, waybill, stop_type)
);

create index if not exists dispatch_routes_driver_status_idx
  on public.dispatch_routes(driver_user_id, status, created_at desc);
create index if not exists dispatch_route_stops_route_sequence_idx
  on public.dispatch_route_stops(route_id, sequence_no);
create index if not exists dispatch_route_stops_waybill_idx
  on public.dispatch_route_stops(waybill);

alter table public.dispatch_routes enable row level security;
alter table public.dispatch_route_stops enable row level security;

-- No direct browser access. All reads/writes go through authenticated Edge Functions.
revoke all on public.dispatch_routes from public, anon, authenticated;
revoke all on public.dispatch_route_stops from public, anon, authenticated;
grant all on public.dispatch_routes to service_role;
grant all on public.dispatch_route_stops to service_role;
