CREATE OR REPLACE FUNCTION public.apply_payfast_payment(
  p_payment_id uuid,
  p_pf_payment_id text,
  p_amount numeric,
  p_payload jsonb
)
RETURNS boolean
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
declare
  v_payment public.payment_transactions%rowtype;
  v_booking public.customer_bookings%rowtype;
  v_updated integer;
begin
  select * into v_payment
  from public.payment_transactions
  where id = p_payment_id
  for update;

  if not found then return false; end if;

  if v_payment.status = 'complete' then
    return v_payment.pf_payment_id = p_pf_payment_id;
  end if;

  if v_payment.status <> 'pending'
     or round(v_payment.amount, 2) <> round(p_amount, 2)
     or p_pf_payment_id is null
     or length(p_pf_payment_id) > 100 then
    return false;
  end if;

  select * into v_booking
  from public.customer_bookings
  where waybill = v_payment.booking_waybill
    and owner_hash = v_payment.owner_id::text
  for update;

  if not found
     or v_booking.payment_method <> 'card'
     or v_booking.paid_at is not null
     or v_booking.refunded_at is not null
     or v_booking.status not in ('pending', 'assigned') then
    return false;
  end if;

  update public.payment_transactions
  set status = 'complete',
      pf_payment_id = p_pf_payment_id,
      raw_itn = p_payload,
      completed_at = now(),
      updated_at = now()
  where id = p_payment_id
    and status = 'pending';

  get diagnostics v_updated = row_count;
  if v_updated <> 1 then return false; end if;

  update public.customer_bookings
  set paid_at = now(),
      payment_source = 'payfast'
  where waybill = v_booking.waybill
    and owner_hash = v_payment.owner_id::text
    and payment_method = 'card'
    and paid_at is null
    and refunded_at is null
    and status in ('pending', 'assigned');

  get diagnostics v_updated = row_count;
  if v_updated <> 1 then
    raise exception 'Booking is no longer eligible for PayFast card payment confirmation';
  end if;

  return true;
end;
$function$;
