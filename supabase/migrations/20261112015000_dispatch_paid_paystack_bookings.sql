create or replace function public.create_next_driver_offer(p_waybill text)
returns jsonb language plpgsql security definer set search_path='public'
as $$
declare b public.customer_bookings%rowtype;v_driver uuid;v_tier text;v_distance double precision;v_offer uuid;
begin
 select * into b from public.customer_bookings where waybill=p_waybill for update;
 if not found or b.paid_at is null or b.refunded_at is not null or b.status<>'pending' or b.driver_user_id is not null then return jsonb_build_object('offered',false,'reason','booking_not_dispatchable'); end if;
 perform pg_advisory_xact_lock(hashtextextended(b.waybill,0));
 with candidates as (
  select d.user_id,
   case when exists(select 1 from public.driver_memberships m where m.driver_user_id=d.user_id and m.status='active' and m.starts_at<=now() and m.ends_at>now()) then 'premium' else 'standard' end as tier,
   case when b.pickup_latitude is not null and b.pickup_longitude is not null and l.latitude is not null then
    6371000*2*asin(sqrt(least(1,power(sin(radians(l.latitude-b.pickup_latitude)/2),2)+cos(radians(b.pickup_latitude))*cos(radians(l.latitude))*power(sin(radians(l.longitude-b.pickup_longitude)/2),2))))
    else null end as meters,
   coalesce((select max(o.offered_at) from public.driver_delivery_offers o where o.driver_user_id=d.user_id),to_timestamp(0)) as last_offer
  from public.driver_profiles d
  left join lateral(select latitude,longitude from public.driver_live_locations where driver_user_id=d.user_id order by updated_at desc limit 1) l on true
  where d.is_online=true and d.can_go_online=true and d.verification_status='approved'
   and d.vehicle_type=b.vehicle
   and not exists(select 1 from public.driver_delivery_offers x where x.waybill=b.waybill and x.driver_user_id=d.user_id)
   and exists(select 1 from public.user_profiles u where u.id=d.user_id and u.role='driver' and u.account_status='active')
 )
 select user_id,tier,meters into v_driver,v_tier,v_distance from candidates order by (tier='premium') desc,meters asc nulls last,last_offer asc limit 1;
 if v_driver is null then return jsonb_build_object('offered',false,'reason','no_eligible_online_drivers'); end if;
 insert into public.driver_delivery_offers(waybill,driver_user_id,priority_tier,distance_meters,expires_at)
 values(b.waybill,v_driver,v_tier,v_distance,now()+interval '30 seconds') returning id into v_offer;
 return jsonb_build_object('offered',true,'offer_id',v_offer,'driver_user_id',v_driver,'priority_tier',v_tier,'expires_at',now()+interval '30 seconds');
end $$;
revoke all on function public.create_next_driver_offer(text) from public,anon,authenticated;
grant execute on function public.create_next_driver_offer(text) to service_role;
create or replace function public.apply_paystack_payment(p_payment_id uuid,p_reference text,p_amount_cents bigint,p_payload jsonb)
returns boolean language plpgsql security definer set search_path='public'
as $$
declare p public.payment_transactions%rowtype; b public.customer_bookings%rowtype; v_otp text;v_updated integer;
begin
 select * into p from public.payment_transactions where id=p_payment_id and provider='paystack' for update;
 if not found then return false; end if;
 if p.status='complete' then return p.provider_reference=p_reference; end if;
 if p.status<>'pending' or p_reference is null or length(p_reference)>100 or round(p.amount*100)::bigint<>p_amount_cents then return false; end if;
 select * into b from public.customer_bookings where waybill=p.booking_waybill and owner_hash=p.owner_id::text for update;
 if not found or b.paid_at is not null or b.refunded_at is not null or b.status in('cancelled','delivered') then return false; end if;
 v_otp:=lpad((floor(random()*10000))::int::text,4,'0');
 update public.payment_transactions set status='complete',provider_reference=p_reference,raw_itn=p_payload,completed_at=now(),updated_at=now() where id=p.id and status='pending';
 get diagnostics v_updated=row_count;if v_updated<>1 then return false;end if;
 update public.customer_bookings set paid_at=now(),payment_source='paystack',pin=v_otp,pin_attempts=0,pin_locked_until=null where waybill=b.waybill;
 insert into public.delivery_status_events(waybill,actor_user_id,previous_status,new_status,notes,metadata)
 values(b.waybill,null,b.status,b.status,'Paystack ZAR payment confirmed',jsonb_build_object('payment_provider','paystack','reference',p_reference));
 perform public.create_next_driver_offer(b.waybill);
 return true;
end $$;
revoke all on function public.apply_paystack_payment(uuid,text,bigint,jsonb) from public,anon,authenticated;
grant execute on function public.apply_paystack_payment(uuid,text,bigint,jsonb) to service_role;