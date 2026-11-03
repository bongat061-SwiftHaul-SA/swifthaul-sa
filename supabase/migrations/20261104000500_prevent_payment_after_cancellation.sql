-- Do not settle a PayFast checkout after its booking was cancelled.
-- Cancellation also closes any still-pending checkout so a delayed ITN cannot settle it.
create or replace function public.apply_payfast_payment(
  p_payment_id uuid,p_pf_payment_id text,p_amount numeric,p_payload jsonb
) returns boolean language plpgsql set search_path=public as $$
declare
  v_payment public.payment_transactions%rowtype;
  v_updated integer;
begin
  select * into v_payment from public.payment_transactions where id=p_payment_id for update;
  if not found then return false; end if;
  if v_payment.status='complete' then return v_payment.pf_payment_id=p_pf_payment_id; end if;
  if v_payment.status<>'pending' or round(v_payment.amount,2)<>round(p_amount,2)
     or p_pf_payment_id is null or length(p_pf_payment_id)>100 then return false; end if;
  update public.payment_transactions set status='complete',pf_payment_id=p_pf_payment_id,
    raw_itn=p_payload,completed_at=now(),updated_at=now()
    where id=p_payment_id and status='pending';
  get diagnostics v_updated=row_count;
  if v_updated<>1 then return false; end if;
  update public.customer_bookings set paid_at=now(),payment_source='payfast'
    where waybill=v_payment.booking_waybill and owner_hash=v_payment.owner_id::text
      and paid_at is null and refunded_at is null and status in ('pending','assigned');
  get diagnostics v_updated=row_count;
  if v_updated<>1 then raise exception 'Booking is no longer eligible for payment confirmation'; end if;
  return true;
end; $$;
revoke all on function public.apply_payfast_payment(uuid,text,numeric,jsonb) from public,anon,authenticated;
grant execute on function public.apply_payfast_payment(uuid,text,numeric,jsonb) to service_role;

create or replace function public.request_booking_refund(
  p_owner_id uuid,p_waybill text,p_request_type text,p_reason text
) returns jsonb language plpgsql security invoker set search_path=public as $$
declare
  v_booking public.customer_bookings%rowtype; v_existing public.booking_refund_requests%rowtype;
  v_source text:='none'; v_amount bigint:=0; v_refund bigint:=0; v_promo bigint:=0;
  v_req public.booking_refund_requests%rowtype;
begin
  if p_owner_id is null or p_waybill is null or length(p_waybill)>100
     or p_request_type is null or p_request_type not in ('cancellation','refund')
     or p_reason is null or length(trim(p_reason))<3 or length(p_reason)>1000 then
    raise exception 'Invalid refund request' using errcode='22023';
  end if;
  select * into v_booking from public.customer_bookings where waybill=p_waybill and owner_hash=p_owner_id::text for update;
  if not found then raise exception 'Booking not found' using errcode='P0002'; end if;
  if v_booking.refunded_at is not null then raise exception 'Booking already refunded' using errcode='23505'; end if;
  if p_request_type='cancellation' then
    if v_booking.status not in ('pending','assigned','accepted') then raise exception 'Booking can no longer be cancelled online' using errcode='55000'; end if;
  elsif v_booking.status not in ('failed','cancelled') then
    raise exception 'Refund requests are available for failed or cancelled deliveries' using errcode='55000';
  end if;
  if v_booking.paid_at is not null then
    if v_booking.payment_source='wallet' then
      v_source:='wallet'; v_refund:=v_booking.wallet_refund_used; v_promo:=v_booking.wallet_promo_used; v_amount:=v_refund+v_promo;
    else
      v_source:='provider'; v_amount:=round(v_booking.price*100)::bigint;
      if v_booking.payment_source='payfast' then
        perform 1 from public.payment_transactions where booking_waybill=v_booking.waybill and status='complete' for update;
        if not found then raise exception 'Verified PayFast payment not found' using errcode='55000'; end if;
      end if;
    end if;
  end if;
  select * into v_existing from public.booking_refund_requests where waybill=p_waybill and status in ('pending','approved','provider_pending') for update;
  if found then return jsonb_build_object('request',to_jsonb(v_existing),'already_requested',true); end if;
  insert into public.booking_refund_requests(owner_id,waybill,request_type,reason,refund_source,refund_amount_cents,
    refund_wallet_refund_cents,refund_wallet_promo_cents)
  values(p_owner_id,p_waybill,p_request_type,trim(p_reason),v_source,v_amount,v_refund,v_promo) returning * into v_req;
  if p_request_type='cancellation' then
    update public.payment_transactions set status='cancelled',updated_at=now()
      where booking_waybill=p_waybill and status='pending';
    update public.customer_bookings set status='cancelled',cancelled_at=now()
      where waybill=p_waybill and status in ('pending','assigned','accepted');
  end if;
  return jsonb_build_object('request',to_jsonb(v_req),'already_requested',false);
end; $$;
revoke all on function public.request_booking_refund(uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.request_booking_refund(uuid,text,text,text) to service_role;
