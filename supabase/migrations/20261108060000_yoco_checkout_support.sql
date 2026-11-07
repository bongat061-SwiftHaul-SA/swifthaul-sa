begin;

alter table public.payment_transactions
  drop constraint if exists payment_transactions_provider_check;
alter table public.payment_transactions
  add constraint payment_transactions_provider_check
  check (provider in ('payfast','paystack','yoco'));

alter table public.payment_transactions
  add column if not exists provider_checkout_id text;

create unique index if not exists payment_transactions_yoco_checkout_id_uidx
  on public.payment_transactions(provider_checkout_id)
  where provider = 'yoco' and provider_checkout_id is not null;

alter table public.customer_bookings
  drop constraint if exists customer_bookings_payment_source_check;
alter table public.customer_bookings
  add constraint customer_bookings_payment_source_check
  check (
    payment_source is null
    or payment_source = any (array['cash','wallet','payfast','paystack','yoco','pay_later']::text[])
  );

create or replace function public.apply_yoco_booking_payment(
  p_checkout_id text,
  p_event_id text,
  p_amount_cents bigint,
  p_currency text,
  p_payment_mode text,
  p_payload jsonb
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payment public.payment_transactions%rowtype;
  v_updated integer;
begin
  if p_checkout_id is null or length(p_checkout_id) > 160
     or p_event_id is null or length(p_event_id) > 160
     or p_amount_cents is null or p_amount_cents < 200
     or p_currency is null or p_currency <> 'ZAR'
     or p_payment_mode is null or p_payment_mode not in ('sandbox','live')
     or p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    return false;
  end if;

  select * into v_payment
  from public.payment_transactions
  where provider = 'yoco' and provider_checkout_id = p_checkout_id
  for update;

  if not found then return false; end if;
  if v_payment.payment_mode <> p_payment_mode
     or v_payment.currency <> p_currency
     or round(v_payment.amount * 100)::bigint <> p_amount_cents then
    return false;
  end if;

  if v_payment.status = 'complete' then
    return v_payment.raw_itn ->> 'id' = p_event_id
       and v_payment.raw_itn #>> '{payload,metadata,checkoutId}' = p_checkout_id;
  end if;
  if v_payment.status <> 'pending' then return false; end if;

  update public.payment_transactions
  set status = 'complete',
      raw_itn = p_payload,
      completed_at = now(),
      updated_at = now()
  where id = v_payment.id and status = 'pending';
  get diagnostics v_updated = row_count;
  if v_updated <> 1 then return false; end if;

  update public.customer_bookings
  set paid_at = now(), payment_source = 'yoco'
  where waybill = v_payment.booking_waybill
    and owner_hash = v_payment.owner_id::text
    and paid_at is null
    and refunded_at is null
    and status in ('pending','assigned');
  get diagnostics v_updated = row_count;
  if v_updated <> 1 then
    raise exception 'Booking is no longer eligible for Yoco payment confirmation';
  end if;
  return true;
end;
$$;

revoke all on function public.apply_yoco_booking_payment(text,text,bigint,text,text,jsonb) from public, anon, authenticated;
grant execute on function public.apply_yoco_booking_payment(text,text,bigint,text,text,jsonb) to service_role;

commit;
