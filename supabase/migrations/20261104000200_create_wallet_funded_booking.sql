-- Atomically pay a customer booking from the SwiftHaul wallet.
-- The Edge Function validates the authenticated customer and quote; this
-- SECURITY INVOKER function performs the balance deduction and booking insert
-- in one database transaction under the service_role connection.

create or replace function public.create_wallet_funded_booking(
  p_owner_hash text,
  p_quote_id uuid,
  p_waybill text,
  p_pin text,
  p_booking jsonb
) returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_quote public.delivery_quotes%rowtype;
  v_wallet public.wallet_accounts%rowtype;
  v_existing public.customer_bookings%rowtype;
  v_refund_used bigint;
  v_promo_used bigint;
  v_total_cents bigint;
  v_order public.customer_bookings%rowtype;
begin
  if p_owner_hash is null or p_quote_id is null or p_booking is null
     or jsonb_typeof(p_booking) <> 'object'
     or p_waybill !~ '^SH-[A-F0-9-]{36}$'
     or p_pin !~ '^\d{4}$'
     or length(trim(coalesce(p_booking->>'recipient',''))) = 0
     or length(p_booking->>'recipient') > 500 then
    raise exception 'Invalid wallet booking request' using errcode = '22023';
  end if;

  select * into v_existing from public.customer_bookings
    where quote_id = p_quote_id and owner_hash = p_owner_hash for update;
  if found then return jsonb_build_object('order',to_jsonb(v_existing),'already_created',true); end if;

  select * into v_quote from public.delivery_quotes
    where id=p_quote_id and owner_hash=p_owner_hash and expires_at>now() for update;
  if not found then raise exception 'Quote expired or not found' using errcode='P0002'; end if;

  select * into v_wallet from public.wallet_accounts where owner_hash=p_owner_hash for update;
  if not found then raise exception 'Wallet account not found' using errcode='P0002'; end if;

  v_total_cents := round(v_quote.price*100)::bigint;
  if v_total_cents<=0 then raise exception 'Invalid booking total' using errcode='22023'; end if;
  v_refund_used := least(v_wallet.refund_cents,v_total_cents);
  v_promo_used := v_total_cents-v_refund_used;
  if v_promo_used>greatest(0,v_wallet.promo_cents-v_wallet.promo_debt_cents) then
    raise exception 'Insufficient wallet balance' using errcode='P0001';
  end if;

  insert into public.customer_bookings (
    waybill,owner_hash,pin,pickup,dropoff,recipient,vehicle,price,
    distance_meters,price_band,quote_id,scheduled_at,return_address,return_at,
    load,distance_fee,payment_method,counter_offer,counter_offer_status,
    pickup_latitude,pickup_longitude,pickup_plus_code,pickup_geohash,
    dropoff_latitude,dropoff_longitude,dropoff_plus_code,dropoff_geohash,
    payment_source,paid_at,wallet_refund_used,wallet_promo_used
  ) values (
    p_waybill,p_owner_hash,p_pin,v_quote.pickup,v_quote.dropoff,trim(p_booking->>'recipient'),
    v_quote.vehicle,v_quote.price,v_quote.distance_meters,v_quote.price_band,v_quote.id,
    nullif(p_booking->>'scheduled_at','')::timestamptz,nullif(p_booking->>'return_address',''),
    nullif(p_booking->>'return_at','')::timestamptz,v_quote.load,v_quote.distance_fee,'dispatch',
    nullif(p_booking->>'counter_offer','')::numeric,coalesce(p_booking->>'counter_offer_status','none'),
    nullif(p_booking->>'pickup_latitude','')::double precision,
    nullif(p_booking->>'pickup_longitude','')::double precision,
    nullif(p_booking->>'pickup_plus_code',''),nullif(p_booking->>'pickup_geohash',''),
    nullif(p_booking->>'dropoff_latitude','')::double precision,
    nullif(p_booking->>'dropoff_longitude','')::double precision,
    nullif(p_booking->>'dropoff_plus_code',''),nullif(p_booking->>'dropoff_geohash',''),
    'wallet',now(),v_refund_used,v_promo_used
  ) returning * into v_order;

  update public.wallet_accounts set refund_cents=refund_cents-v_refund_used,
    promo_cents=promo_cents-v_promo_used where owner_hash=p_owner_hash;

  insert into public.wallet_ledger(id,owner_hash,event_key,refund_delta,promo_delta,description,promo_debt_delta)
  values(gen_random_uuid(),p_owner_hash,'wallet-booking:'||p_waybill,-v_refund_used,-v_promo_used,
    'Wallet payment for delivery booking '||p_waybill,0);

  return jsonb_build_object('order',to_jsonb(v_order),'already_created',false);
end;
$$;

revoke all on function public.create_wallet_funded_booking(text,uuid,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.create_wallet_funded_booking(text,uuid,text,text,jsonb) to service_role;
