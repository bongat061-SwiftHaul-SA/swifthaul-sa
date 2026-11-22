-- Admin review for customer-selected vehicles that fall below the estimated load capacity.
alter table public.customer_bookings
  add column if not exists vehicle_suitability_status text not null default 'not_required';

alter table public.customer_bookings
  drop constraint if exists customer_bookings_vehicle_suitability_status_check;

alter table public.customer_bookings
  add constraint customer_bookings_vehicle_suitability_status_check
  check (vehicle_suitability_status in ('not_required','pending_admin_review','approved','declined'));

-- Driver earnings become available only when both delivery completion and company-confirmed payment exist.
create or replace function public.credit_driver_earning_on_delivery()
returns trigger
language plpgsql
set search_path = public
as $function$
declare
  v_gross_cents bigint;
  v_driver_cents bigint;
begin
  if new.status = 'delivered'
     and new.paid_at is not null
     and (old.status is distinct from 'delivered' or old.paid_at is distinct from new.paid_at)
     and new.driver_user_id is not null
     and new.price is not null
     and new.price > 0 then
    v_gross_cents := round(new.price * 100)::bigint;
    v_driver_cents := round(v_gross_cents * 0.75)::bigint;
    if v_driver_cents > 0 then
      insert into public.driver_earnings_ledger (
        driver_user_id, event_key, event_type, amount_cents, waybill, description
      ) values (
        new.driver_user_id,
        'delivery-earning:' || new.waybill,
        'earning',
        v_driver_cents,
        new.waybill,
        'Driver share: 75% of paid and completed delivery charge R' || to_char(new.price, 'FM999999990.00')
      ) on conflict (event_key) do nothing;
    end if;
  end if;
  return new;
end;
$function$;

drop trigger if exists credit_driver_earning_after_delivery on public.customer_bookings;
create trigger credit_driver_earning_after_delivery
after update of status, paid_at on public.customer_bookings
for each row
when (
  new.status = 'delivered'
  and new.paid_at is not null
  and (old.status is distinct from 'delivered' or old.paid_at is distinct from new.paid_at)
)
execute function public.credit_driver_earning_on_delivery();

revoke all on function public.credit_driver_earning_on_delivery() from public, anon, authenticated;
grant execute on function public.credit_driver_earning_on_delivery() to service_role;
