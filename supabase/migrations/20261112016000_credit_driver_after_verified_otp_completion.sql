create or replace function public.credit_driver_on_delivery_status()
returns trigger language plpgsql security definer set search_path='public'
as $$
declare v_net bigint;
begin
 if new.status<>'delivered' or new.paid_at is null or new.refunded_at is not null or new.driver_user_id is null then return new; end if;
 if not exists(select 1 from public.proof_of_delivery p where p.waybill=new.waybill and p.recipient_pin_verified_at is not null) then return new; end if;
 v_net:=round(new.price*100*0.75)::bigint;
 if v_net>0 then
  insert into public.driver_earnings_ledger(driver_user_id,event_key,event_type,amount_cents,waybill,description)
  values(new.driver_user_id,'paid-delivery:'||new.waybill,'delivery_completed',v_net,new.waybill,'75% driver share after verified recipient OTP')
  on conflict(event_key) do nothing;
 end if;
 return new;
end $$;
drop trigger if exists credit_driver_on_delivery_status on public.customer_bookings;
create trigger credit_driver_on_delivery_status after update of status on public.customer_bookings for each row execute function public.credit_driver_on_delivery_status();