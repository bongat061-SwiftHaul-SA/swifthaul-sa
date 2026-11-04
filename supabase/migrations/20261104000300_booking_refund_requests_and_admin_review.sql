create table if not exists public.booking_refund_requests (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete restrict,
  waybill text not null references public.customer_bookings(waybill) on delete restrict,
  request_type text not null check (request_type in ('cancellation','refund')),
  reason text not null check (char_length(reason) between 3 and 1000),
  refund_source text not null check (refund_source in ('none','wallet','provider')),
  refund_amount_cents bigint not null default 0 check (refund_amount_cents >= 0),
  refund_wallet_refund_cents bigint not null default 0 check (refund_wallet_refund_cents >= 0),
  refund_wallet_promo_cents bigint not null default 0 check (refund_wallet_promo_cents >= 0),
  status text not null default 'pending' check (status in ('pending','approved','provider_pending','completed','rejected')),
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  provider_reference text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(id, waybill)
);
create unique index if not exists booking_refund_one_open_request_per_booking
  on public.booking_refund_requests(waybill)
  where status in ('pending','approved','provider_pending');
alter table public.booking_refund_requests enable row level security;
revoke all on public.booking_refund_requests from anon, authenticated, public;
grant all on public.booking_refund_requests to service_role;

alter table public.payment_transactions drop constraint if exists payment_transactions_status_check;
alter table public.payment_transactions add constraint payment_transactions_status_check
  check (status in ('pending','complete','failed','cancelled','refunded'));
alter table public.payment_transactions
  add column if not exists refunded_at timestamptz,
  add column if not exists refund_reference text;

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

create or replace function public.review_booking_refund(
  p_admin_id uuid, p_request_id uuid, p_action text, p_provider_reference text default null
) returns jsonb language plpgsql security invoker set search_path=public as $$
declare
  v_req public.booking_refund_requests%rowtype;
  v_booking public.customer_bookings%rowtype;
  v_result text;
begin
  if p_admin_id is null or p_request_id is null or p_action not in ('approve','reject','provider_complete') then
    raise exception 'Invalid refund review action' using errcode='22023';
  end if;
  select * into v_req from public.booking_refund_requests where id=p_request_id for update;
  if not found then raise exception 'Refund request not found' using errcode='P0002'; end if;
  select * into v_booking from public.customer_bookings where waybill=v_req.waybill for update;
  if p_action='reject' then
    if v_req.status<>'pending' then raise exception 'Request is not awaiting review' using errcode='55000'; end if;
    update public.booking_refund_requests set status='rejected',reviewed_by=p_admin_id,reviewed_at=now(),updated_at=now()
      where id=p_request_id returning status into v_result;
    return jsonb_build_object('status',v_result);
  end if;
  if p_action='approve' then
    if v_req.status<>'pending' then raise exception 'Request is not awaiting review' using errcode='55000'; end if;
    if v_req.refund_source='none' or v_req.refund_amount_cents=0 then
      update public.booking_refund_requests set status='completed',reviewed_by=p_admin_id,reviewed_at=now(),updated_at=now()
        where id=p_request_id returning status into v_result;
      return jsonb_build_object('status',v_result,'refund_amount_cents',0);
    elsif v_req.refund_source='wallet' then
      update public.wallet_accounts set refund_cents=refund_cents+v_req.refund_wallet_refund_cents,
        promo_cents=promo_cents+v_req.refund_wallet_promo_cents where owner_hash=v_req.owner_id::text;
      if not found then raise exception 'Wallet account not found' using errcode='P0002'; end if;
      insert into public.wallet_ledger(id,owner_hash,event_key,refund_delta,promo_delta,description,promo_debt_delta)
      values(gen_random_uuid(),v_req.owner_id::text,'booking-refund:'||v_req.id::text,
        v_req.refund_wallet_refund_cents,v_req.refund_wallet_promo_cents,'Approved refund for booking '||v_req.waybill,0);
      update public.customer_bookings set refunded_at=now() where waybill=v_req.waybill and refunded_at is null;
      update public.booking_refund_requests set status='completed',reviewed_by=p_admin_id,reviewed_at=now(),updated_at=now()
        where id=p_request_id returning status into v_result;
      return jsonb_build_object('status',v_result,'refund_amount_cents',v_req.refund_amount_cents);
    else
      update public.booking_refund_requests set status='provider_pending',reviewed_by=p_admin_id,reviewed_at=now(),updated_at=now()
        where id=p_request_id returning status into v_result;
      return jsonb_build_object('status',v_result,'refund_amount_cents',v_req.refund_amount_cents,'requires_external_provider_refund',true);
    end if;
  end if;
  if p_action='provider_complete' then
    if v_req.status<>'provider_pending' or v_req.refund_source<>'provider'
       or p_provider_reference is null or length(trim(p_provider_reference))<3 or length(p_provider_reference)>200 then
      raise exception 'Provider refund reference required after external refund' using errcode='22023';
    end if;
    update public.customer_bookings set refunded_at=now() where waybill=v_req.waybill and refunded_at is null;
    if not found then raise exception 'Booking already marked refunded' using errcode='23505'; end if;
    update public.payment_transactions set status='refunded',refunded_at=now(),refund_reference=trim(p_provider_reference),updated_at=now()
      where booking_waybill=v_req.waybill and status='complete';
    update public.booking_refund_requests set status='completed',provider_reference=trim(p_provider_reference),
      reviewed_by=p_admin_id,reviewed_at=now(),updated_at=now() where id=p_request_id returning status into v_result;
    return jsonb_build_object('status',v_result,'refund_amount_cents',v_req.refund_amount_cents);
  end if;
end; $$;
revoke all on function public.review_booking_refund(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.review_booking_refund(uuid,uuid,text,text) to service_role;
