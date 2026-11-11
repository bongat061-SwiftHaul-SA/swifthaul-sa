create table if not exists public.vehicle_classes (
  vehicle_type text primary key,
  max_concurrent_orders integer not null check (max_concurrent_orders between 1 and 10),
  updated_at timestamptz not null default now()
);
insert into public.vehicle_classes(vehicle_type,max_concurrent_orders) values
 ('motorbike',2),('hatchback/sedan',2),('bakkie/panel van',3),('truck',4)
on conflict(vehicle_type) do update set max_concurrent_orders=excluded.max_concurrent_orders,updated_at=now();
alter table public.driver_profiles add column if not exists allow_stacked_orders boolean not null default true;
create table if not exists public.driver_route_stops (
  id uuid primary key default gen_random_uuid(),
  driver_id uuid not null references auth.users(id) on delete cascade,
  order_id text not null references public.customer_bookings(waybill) on delete cascade,
  stop_type text not null check(stop_type in ('pickup','dropoff')),
  sequence_order integer not null check(sequence_order > 0),
  address text not null default '',
  lat double precision,
  lng double precision,
  status text not null default 'pending' check(status in ('pending','arrived','completed')),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint driver_route_stops_order_type_unique unique(order_id,stop_type)
);
create index if not exists driver_route_stops_driver_sequence_idx on public.driver_route_stops(driver_id,sequence_order) where status <> 'completed';
create index if not exists driver_route_stops_order_idx on public.driver_route_stops(order_id);
alter table public.driver_route_stops enable row level security;
revoke all on public.driver_route_stops from anon,authenticated;
grant all on public.driver_route_stops to service_role;
alter table public.vehicle_classes enable row level security;
revoke all on public.vehicle_classes from anon,authenticated;
grant all on public.vehicle_classes to service_role;
create or replace function public.driver_active_order_count(p_driver_id uuid)
returns integer language sql stable security invoker set search_path=''
as $$ select count(*)::integer from public.customer_bookings b where b.driver_user_id=p_driver_id and b.status in ('assigned','accepted','picked_up','in_transit') and b.completed_at is null; $$;
revoke all on function public.driver_active_order_count(uuid) from public,anon,authenticated;
grant execute on function public.driver_active_order_count(uuid) to service_role;
create or replace function public.accept_driver_delivery_offer(p_driver_user_id uuid,p_waybill text,p_offer_id uuid)
returns jsonb language plpgsql security invoker set search_path=''
as $function$
declare v_profile public.driver_profiles%rowtype; v_booking public.customer_bookings%rowtype; v_offer public.driver_delivery_offers%rowtype; v_active_count integer; v_capacity integer; v_next_sequence integer;
begin
 select * into v_profile from public.driver_profiles where user_id=p_driver_user_id for update;
 if not found or not v_profile.is_online or v_profile.verification_status<>'approved' then raise exception 'driver_not_eligible'; end if;
 select * into v_offer from public.driver_delivery_offers where id=p_offer_id and driver_user_id=p_driver_user_id for update;
 if not found or v_offer.waybill<>p_waybill or v_offer.status<>'offered' or v_offer.expires_at<=now() then raise exception 'offer_expired_or_closed'; end if;
 select * into v_booking from public.customer_bookings where waybill=p_waybill for update;
 if not found or v_booking.status<>'pending' or v_booking.driver_user_id is not null or v_booking.refunded_at is not null then raise exception 'delivery_no_longer_available'; end if;
 select count(*)::integer into v_active_count from public.customer_bookings where driver_user_id=p_driver_user_id and status in ('assigned','accepted','picked_up','in_transit') and completed_at is null;
 select max_concurrent_orders into v_capacity from public.vehicle_classes where vehicle_type=case
  when lower(coalesce(v_profile.vehicle_type,'')) like '%motor%' then 'motorbike'
  when lower(coalesce(v_profile.vehicle_type,'')) like '%bakkie%' or lower(coalesce(v_profile.vehicle_type,'')) like '%van%' or lower(coalesce(v_profile.vehicle_type,'')) like '%panel%' then 'bakkie/panel van'
  when lower(coalesce(v_profile.vehicle_type,'')) like '%truck%' or lower(coalesce(v_profile.vehicle_type,'')) like '%ton%' then 'truck' else 'hatchback/sedan' end;
 if v_active_count>=coalesce(v_capacity,1) then raise exception 'driver_capacity_reached'; end if;
 if v_active_count>0 and not v_profile.allow_stacked_orders then raise exception 'stacked_orders_disabled'; end if;
 update public.customer_bookings set driver_user_id=p_driver_user_id,assigned_driver=p_driver_user_id::text,status='assigned' where waybill=p_waybill;
 select coalesce(max(sequence_order),0)+1 into v_next_sequence from public.driver_route_stops where driver_id=p_driver_user_id and status<>'completed';
 insert into public.driver_route_stops(driver_id,order_id,stop_type,sequence_order,address,lat,lng)
 values (p_driver_user_id,p_waybill,'pickup',v_next_sequence,coalesce(v_booking.pickup,''),v_booking.pickup_latitude,v_booking.pickup_longitude),
 (p_driver_user_id,p_waybill,'dropoff',v_next_sequence+1,coalesce(v_booking.dropoff,''),v_booking.dropoff_latitude,v_booking.dropoff_longitude)
 on conflict(order_id,stop_type) do nothing;
 update public.driver_delivery_offers set status='accepted',responded_at=now() where id=p_offer_id;
 update public.driver_delivery_offers set status='cancelled',responded_at=now() where waybill=p_waybill and status='offered' and id<>p_offer_id;
 return jsonb_build_object('accepted',true,'waybill',p_waybill,'active_order_count',v_active_count+1,'capacity',coalesce(v_capacity,1));
end;
$function$;
revoke all on function public.accept_driver_delivery_offer(uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.accept_driver_delivery_offer(uuid,text,uuid) to service_role;