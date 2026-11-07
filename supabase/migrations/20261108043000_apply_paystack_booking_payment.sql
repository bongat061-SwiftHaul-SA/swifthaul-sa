begin;

create or replace function public.apply_paystack_booking_payment(
  p_reference text,
  p_paystack_transaction_id text,
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
  if p_reference is null or length(p_reference) > 100
     or p_paystack_transaction_id is null or length(p_paystack_transaction_id) > 100
     or p_amount_cents < 500 or p_currency <> 'ZAR'
     or p_payment_mode not in ('sandbox','live') then
    return false;
  end if;

  select * into v_payment
  from public.payment_transactions
  where provider = 'paystack' and provider_reference = p_reference
  for update;

  if not found then return false; end if;
  if v_payment.payment_mode <> p_payment_mode then return false; end if;
  if v_payment.status = 'complete' then
    return v_payment.provider_reference = p_reference
       and v_payment.currency = p_currency
       and round(v_payment.amount * 100)::bigint = p_amount_cents
       and v_payment.raw_itn ->> 'transaction_id' = p_paystack_transaction_id;
  end if;
  if v_payment.status <> 'pending'
     or v_payment.currency <> 'ZAR'
     or round(v_payment.amount * 100)::bigint <> p_amount_cents then
    return false;
  end if;

  update public.payment_transactions
  set status = 'complete',
      raw_itn = p_payload,
      completed_at = now(),
      updated_at = now()
  where id = v_payment.id and status = 'pending';
  get diagnostics v_updated = row_count;
  if v_updated <> 1 then return false; end if;

  update public.customer_bookings
  set paid_at = now(), payment_source = 'paystack'
  where waybill = v_payment.booking_waybill
    and owner_hash = v_payment.owner_id::text
    and paid_at is null
    and refunded_at is null
    and status in ('pending','assigned');
  get diagnostics v_updated = row_count;
  if v_updated <> 1 then
    raise exception 'Booking is no longer eligible for Paystack payment confirmation';
  end if;
  return true;
end;
$$;

revoke all on function public.apply_paystack_booking_payment(text,text,bigint,text,text,jsonb) from public, anon, authenticated;
grant execute on function public.apply_paystack_booking_payment(text,text,bigint,text,text,jsonb) to service_role;

commit;
