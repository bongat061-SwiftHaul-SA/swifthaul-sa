create table if not exists public.driver_delivery_offers (
  id uuid primary key default gen_random_uuid(),
  waybill text not null references public.customer_bookings(waybill) on delete cascade,
  driver_user_id uuid not null references public.user_profiles(id) on delete cascade,
  priority_tier text not null check (priority_tier in ('premium','standard')),
  distance_meters double precision,
  status text not null default 'offered' check (status in ('offered','accepted','declined','expired','cancelled')),
  offered_at timestamptz not null default now(),
  expires_at timestamptz not null,
  responded_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists driver_delivery_offers_driver_status_idx on public.driver_delivery_offers(driver_user_id,status,expires_at);
create index if not exists driver_delivery_offers_waybill_status_idx on public.driver_delivery_offers(waybill,status,offered_at desc);
alter table public.driver_delivery_offers enable row level security;
revoke all on public.driver_delivery_offers from public, anon, authenticated;
grant all on public.driver_delivery_offers to service_role;
