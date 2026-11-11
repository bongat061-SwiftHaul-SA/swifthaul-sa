-- Customer delivery ratings, quality alerts and rolling driver performance.
create table if not exists public.delivery_ratings (
 id uuid primary key default gen_random_uuid(),
 order_id text not null references public.customer_bookings(waybill) on delete cascade,
 driver_id uuid not null references public.driver_profiles(user_id) on delete restrict,
 fleet_id uuid references public.fleets(id) on delete set null,
 rater_role text not null check(rater_role in ('sender','recipient')),
 stars integer not null check(stars between 1 and 5),
 tags text[] not null default '{}',
 comment text,
 created_at timestamptz not null default now(),
 constraint delivery_ratings_order_role_unique unique(order_id,rater_role),
 constraint delivery_ratings_comment_limit check(comment is null or length(comment)<=1200)
);
create index if not exists delivery_ratings_driver_created_idx on public.delivery_ratings(driver_id,created_at desc);
create table if not exists public.quality_alerts (
 id uuid primary key default gen_random_uuid(),
 order_id text not null references public.customer_bookings(waybill) on delete cascade,
 driver_id uuid not null references public.driver_profiles(user_id) on delete restrict,
 fleet_id uuid references public.fleets(id) on delete set null,
 rating_id uuid references public.delivery_ratings(id) on delete cascade,
 priority text not null default 'high' check(priority in ('normal','high','critical')),
 reason text not null,
 tags text[] not null default '{}',
 status text not null default 'open' check(status in ('open','reviewing','resolved','dismissed')),
 created_at timestamptz not null default now(),
 resolved_at timestamptz,
 resolved_by uuid references public.user_profiles(id) on delete set null,
 resolution_notes text
);
create index if not exists quality_alerts_open_idx on public.quality_alerts(status,priority,created_at desc);
alter table public.driver_profiles add column if not exists average_rating numeric(3,2) not null default 5.00;
alter table public.driver_profiles add column if not exists total_ratings integer not null default 0;
alter table public.driver_profiles add column if not exists on_time_percentage numeric(5,2) not null default 100.00;
alter table public.driver_profiles add column if not exists completion_percentage numeric(5,2) not null default 100.00;
alter table public.driver_profiles add column if not exists performance_score integer not null default 100;
alter table public.driver_profiles add column if not exists performance_tier text not null default 'gold' check(performance_tier in ('gold','standard','watchlist','review_required'));
alter table public.delivery_ratings enable row level security;
alter table public.quality_alerts enable row level security;
revoke all on public.delivery_ratings,public.quality_alerts from anon,authenticated;
grant all on public.delivery_ratings,public.quality_alerts to service_role;
create or replace function public.recalculate_driver_score(p_driver_id uuid)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare v_avg numeric(3,2); v_count integer; v_ontime numeric(5,2); v_complete numeric(5,2); v_pod numeric(5,2); v_score integer; v_tier text; v_trips integer;
begin
 with recent as (select b.* from public.customer_bookings b where b.driver_user_id=p_driver_id and b.accepted_at is not null order by b.accepted_at desc limit 50),
 rating_stats as (select avg(r.stars)::numeric(3,2) avg_rating,count(*)::integer rating_count from public.delivery_ratings r where r.driver_id=p_driver_id and r.order_id in(select waybill from recent)),
 trip_stats as (select count(*)::integer trip_count,count(*) filter(where status='delivered')::integer delivered_count,
 count(*) filter(where status='delivered' and (scheduled_at is null or arrived_pickup_at is null or arrived_pickup_at<=scheduled_at+interval '15 minutes'))::integer ontime_count,
 count(*) filter(where status='delivered' and exists(select 1 from public.proof_of_delivery p where p.waybill=recent.waybill and p.driver_user_id=p_driver_id and p.recipient_pin_verified_at is not null))::integer pod_count from recent)
 select coalesce(rs.avg_rating,5.00),coalesce(rs.rating_count,0),case when ts.delivered_count=0 then 100 else round(100.0*ts.ontime_count/ts.delivered_count,2) end,
 case when ts.trip_count=0 then 100 else round(100.0*ts.delivered_count/ts.trip_count,2) end,
 case when ts.delivered_count=0 then 100 else round(100.0*ts.pod_count/ts.delivered_count,2) end,ts.trip_count
 into v_avg,v_count,v_ontime,v_complete,v_pod,v_trips from rating_stats rs cross join trip_stats ts;
 v_score:=greatest(0,least(100,round((v_avg*20*0.40)+(v_ontime*0.25)+(v_complete*0.20)+(v_pod*0.15))::integer));
 v_tier:=case when v_score>=90 then 'gold' when v_score>=75 then 'standard' when v_score>=60 then 'watchlist' when v_trips>=10 then 'review_required' else 'watchlist' end;
 update public.driver_profiles set average_rating=v_avg,total_ratings=v_count,on_time_percentage=v_ontime,completion_percentage=v_complete,performance_score=v_score,performance_tier=v_tier,updated_at=now() where user_id=p_driver_id;
 return jsonb_build_object('driver_id',p_driver_id,'average_rating',v_avg,'total_ratings',v_count,'on_time_percentage',v_ontime,'completion_percentage',v_complete,'proof_capture_percentage',v_pod,'performance_score',v_score,'performance_tier',v_tier,'trips_scored',v_trips);
end $$;
revoke all on function public.recalculate_driver_score(uuid) from public,anon,authenticated;
grant execute on function public.recalculate_driver_score(uuid) to service_role;
create or replace function public.on_delivery_rating_created()
returns trigger language plpgsql security definer set search_path=public as $$
begin
 perform public.recalculate_driver_score(new.driver_id);
 if new.stars<=2 or new.tags && array['Damaged Parcel','Asked for Extra Cash']::text[] then
 insert into public.quality_alerts(order_id,driver_id,fleet_id,rating_id,priority,reason,tags)
 values(new.order_id,new.driver_id,new.fleet_id,new.id,case when new.stars=1 or new.tags @> array['Asked for Extra Cash']::text[] then 'critical' else 'high' end,
 case when new.stars<=2 then 'Low customer rating ('||new.stars||'/5)' else 'Customer reported a delivery issue' end,new.tags);
 end if;
 return new;
end $$;
revoke all on function public.on_delivery_rating_created() from public,anon,authenticated;
drop trigger if exists delivery_rating_score_and_quality on public.delivery_ratings;
create trigger delivery_rating_score_and_quality after insert on public.delivery_ratings for each row execute function public.on_delivery_rating_created();

alter table public.driver_delivery_offers add column if not exists priority_window_ends_at timestamptz;
create or replace function public.recalculate_driver_score_on_trip_change()
returns trigger language plpgsql security definer set search_path=public as $$
begin
 if new.driver_user_id is not null and (old.status is distinct from new.status or old.arrived_pickup_at is distinct from new.arrived_pickup_at or old.completed_at is distinct from new.completed_at) then
  perform public.recalculate_driver_score(new.driver_user_id);
 end if;
 return new;
end $$;
revoke all on function public.recalculate_driver_score_on_trip_change() from public,anon,authenticated;
drop trigger if exists customer_booking_recalculate_driver_score on public.customer_bookings;
create trigger customer_booking_recalculate_driver_score after update of status,arrived_pickup_at,completed_at on public.customer_bookings for each row execute function public.recalculate_driver_score_on_trip_change();

-- Correct on-time SLA denominator to only scheduled pickups with recorded arrival times.
create or replace function public.recalculate_driver_score(p_driver_id uuid)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare v_avg numeric(3,2); v_count integer; v_ontime numeric(5,2); v_complete numeric(5,2); v_pod numeric(5,2); v_score integer; v_tier text; v_trips integer; v_completed integer;
begin
 with recent as (select b.* from public.customer_bookings b where b.driver_user_id=p_driver_id and b.accepted_at is not null order by b.accepted_at desc limit 50),
 rating_stats as (select avg(r.stars)::numeric(3,2) avg_rating,count(*)::integer rating_count from public.delivery_ratings r where r.driver_id=p_driver_id and r.order_id in(select waybill from recent)),
 trip_stats as (select count(*)::integer trip_count,count(*) filter(where status='delivered')::integer delivered_count,
 count(*) filter(where status='delivered' and scheduled_at is not null and arrived_pickup_at is not null and arrived_pickup_at<=scheduled_at+interval '15 minutes')::integer ontime_count,
 count(*) filter(where status='delivered' and scheduled_at is not null and arrived_pickup_at is not null)::integer scheduled_count,
 count(*) filter(where status='delivered' and exists(select 1 from public.proof_of_delivery p where p.waybill=recent.waybill and p.driver_user_id=p_driver_id and p.recipient_pin_verified_at is not null))::integer pod_count from recent)
 select coalesce(rs.avg_rating,5.00),coalesce(rs.rating_count,0),case when ts.scheduled_count=0 then 100 else round(100.0*ts.ontime_count/ts.scheduled_count,2) end,
 case when ts.trip_count=0 then 100 else round(100.0*ts.delivered_count/ts.trip_count,2) end,
 case when ts.delivered_count=0 then 100 else round(100.0*ts.pod_count/ts.delivered_count,2) end,ts.trip_count,ts.delivered_count
 into v_avg,v_count,v_ontime,v_complete,v_pod,v_trips,v_completed from rating_stats rs cross join trip_stats ts;
 v_score:=greatest(0,least(100,round((v_avg*20*0.40)+(v_ontime*0.25)+(v_complete*0.20)+(v_pod*0.15))::integer));
 v_tier:=case when v_score>=90 then 'gold' when v_score>=75 then 'standard' when v_score>=60 then 'watchlist' when v_completed>=10 then 'review_required' else 'watchlist' end;
 update public.driver_profiles set average_rating=v_avg,total_ratings=v_count,on_time_percentage=v_ontime,completion_percentage=v_complete,performance_score=v_score,performance_tier=v_tier,updated_at=now() where user_id=p_driver_id;
 return jsonb_build_object('driver_id',p_driver_id,'average_rating',v_avg,'total_ratings',v_count,'on_time_percentage',v_ontime,'completion_percentage',v_complete,'proof_capture_percentage',v_pod,'performance_score',v_score,'performance_tier',v_tier,'trips_scored',v_trips,'completed_trips',v_completed);
end $$;

-- Exclude quality-alerted deliveries from valid OTP/POD-without-dispute scoring.
create or replace function public.recalculate_driver_score(p_driver_id uuid)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare v_avg numeric(3,2); v_count integer; v_ontime numeric(5,2); v_complete numeric(5,2); v_pod numeric(5,2); v_score integer; v_tier text; v_trips integer; v_completed integer;
begin
 with recent as (select b.* from public.customer_bookings b where b.driver_user_id=p_driver_id and b.accepted_at is not null order by b.accepted_at desc limit 50),
 rating_stats as (select avg(r.stars)::numeric(3,2) avg_rating,count(*)::integer rating_count from public.delivery_ratings r where r.driver_id=p_driver_id and r.order_id in(select waybill from recent)),
 trip_stats as (select count(*)::integer trip_count,count(*) filter(where status='delivered')::integer delivered_count,
 count(*) filter(where status='delivered' and scheduled_at is not null and arrived_pickup_at is not null and arrived_pickup_at<=scheduled_at+interval '15 minutes')::integer ontime_count,
 count(*) filter(where status='delivered' and scheduled_at is not null and arrived_pickup_at is not null)::integer scheduled_count,
 count(*) filter(where status='delivered' and exists(select 1 from public.proof_of_delivery p where p.waybill=recent.waybill and p.driver_user_id=p_driver_id and p.recipient_pin_verified_at is not null)
 and not exists(select 1 from public.quality_alerts q where q.order_id=recent.waybill and q.status<>'dismissed'))::integer pod_count from recent)
 select coalesce(rs.avg_rating,5.00),coalesce(rs.rating_count,0),case when ts.scheduled_count=0 then 100 else round(100.0*ts.ontime_count/ts.scheduled_count,2) end,
 case when ts.trip_count=0 then 100 else round(100.0*ts.delivered_count/ts.trip_count,2) end,
 case when ts.delivered_count=0 then 100 else round(100.0*ts.pod_count/ts.delivered_count,2) end,ts.trip_count,ts.delivered_count
 into v_avg,v_count,v_ontime,v_complete,v_pod,v_trips,v_completed from rating_stats rs cross join trip_stats ts;
 v_score:=greatest(0,least(100,round((v_avg*20*0.40)+(v_ontime*0.25)+(v_complete*0.20)+(v_pod*0.15))::integer));
 v_tier:=case when v_score>=90 then 'gold' when v_score>=75 then 'standard' when v_score>=60 then 'watchlist' when v_completed>=10 then 'review_required' else 'watchlist' end;
 update public.driver_profiles set average_rating=v_avg,total_ratings=v_count,on_time_percentage=v_ontime,completion_percentage=v_complete,performance_score=v_score,performance_tier=v_tier,updated_at=now() where user_id=p_driver_id;
 return jsonb_build_object('driver_id',p_driver_id,'average_rating',v_avg,'total_ratings',v_count,'on_time_percentage',v_ontime,'completion_percentage',v_complete,'proof_capture_percentage',v_pod,'performance_score',v_score,'performance_tier',v_tier,'trips_scored',v_trips,'completed_trips',v_completed);
end $$;
