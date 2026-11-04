create or replace function public.request_booking_refund(
  p_owner_id uuid, p_waybill text, p_request_type text, p_reason text
) returns jsonb language plpgsql security invoker set search_path=public as $$
declare
  v_booking public.customer_bookings%rowtype;
  v_existing public.booking_refund_requests%rowtype;
  v_source text := 'none'; v_amount bigint := 0; v_refund bigint := 0; v_promo bigint := 0;
  v_req public.booking_refund_requests%rowtype;
begin
  if p_owner_id is null or p_waybill is null or length(p_waybill)>100
     or p_request_type is null or p_request_type not in ('cancellation','refund')
     or p_reason is null or length(trim(p_reason))<3 or length(p_reason)>1000 then
    raise exception 'Invalid refund request' using errcode='22023';
  end if;
  select * into v_booking from public.customer_bookings
   where waybill=p_waybill and owner_hash=p_owner_id::text for update;
  if not found then raise exception 'Booking not found' using errcode='P0002'; end if;
  if v_booking.refunded_at is not null then raise exception 'Booking already refunded' using errcode='23505'; end if;
  if p_request_type='cancellation' then
    if v_booking.status not in ('pending','assigned','accepted') then
      raise exception 'Booking can no longer be cancelled online' using errcode='55000';
    end if;
  else
    if v_booking.status not in ('failed','cancelled') then
      raise exception 'Refund requests are available for failed or cancelled deliveries' using errcode='55000';
    end if;
  end if;
  if v_booking.paid_at is not null then
    if v_booking.payment_source='wallet' then
      v_source:='wallet'; v_refund:=v_booking.wallet_refund_used; v_promo:=v_booking.wallet_promo_used;
      v_amount:=v_refund+v_promo;
    else
      v_source:='provider'; v_amount:=round(v_booking.price*100)::bigint;
      if v_booking.payment_source='payfast' then
        perform 1 from public.payment_transactions where booking_waybill=v_booking.waybill and status='complete' for update;
        if not found then raise exception 'Verified PayFast payment not found' using errcode='55000'; end if;
      end if;
    end if;
  end if;
  select * into v_existing from public.booking_refund_requests
    where waybill=p_waybill and status in ('pending','approved','provider_pending') for update;
  if found then return jsonb_build_object('request',to_jsonb(v_existing),'already_requested',true); end if;
  insert into public.booking_refund_requests(owner_id,waybill,request_type,reason,refund_source,refund_amount_cents,
    refund_wallet_refund_cents,refund_wallet_promo_cents)
  values(p_owner_id,p_waybill,p_request_type,trim(p_reason),v_source,v_amount,v_refund,v_promo)
  returning * into v_req;
  if p_request_type='cancellation' then
    update public.customer_bookings set status='cancelled',cancelled_at=now()
      where waybill=p_waybill and status in ('pending','assigned','accepted');
  end if;
  return jsonb_build_object('request',to_jsonb(v_req),'already_requested',false);
end; $$;
revoke all on function public.request_booking_refund(uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.request_booking_refund(uuid,text,text,text) to service_role;
create index if not exists booking_refund_requests_owner_created_idx on public.booking_refund_requests(owner_id,created_at desc);
create index if not exists booking_refund_requests_reviewed_by_idx on public.booking_refund_requests(reviewed_by) where reviewed_by is not null;
