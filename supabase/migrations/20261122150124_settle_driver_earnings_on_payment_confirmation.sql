create or replace function public.credit_driver_after_booking_payment()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
begin
  if new.status = 'delivered'
     and new.paid_at is not null
     and new.refunded_at is null
     and new.driver_user_id is not null
     and (old.paid_at is distinct from new.paid_at
          or old.driver_user_id is distinct from new.driver_user_id) then
    perform public.settle_driver_delivery_earning(new.waybill);
  end if;
  return new;
end;
$function$;

revoke all on function public.credit_driver_after_booking_payment()
from public, anon, authenticated;

drop trigger if exists credit_driver_after_booking_payment on public.customer_bookings;
create trigger credit_driver_after_booking_payment
after update of paid_at, driver_user_id on public.customer_bookings
for each row
execute function public.credit_driver_after_booking_payment();