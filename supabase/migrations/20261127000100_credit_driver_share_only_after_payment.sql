-- A delivery earns the driver share only after both delivery and payment are confirmed.
-- This preserves the 25% platform / 75% driver pool and existing fleet-contract split.
-- Apply in staging first; do not deploy this migration to production without a separate approval.
begin;
create or replace function public.credit_driver_earning_on_delivery()
returns trigger language plpgsql set search_path=public as $$
declare
 v_gross bigint; v_platform bigint; v_net bigint; v_fleet bigint; v_driver bigint;
 v_contract public.fleet_driver_contracts%rowtype; v_fleet_id uuid;
 v_owner uuid; v_owner_recipient text; v_driver_recipient text; v_remaining bigint;
 v_week date;
begin
 if new.status<>'delivered' or new.paid_at is null
   or (old.status is not distinct from 'delivered' and old.paid_at is not null)
   or new.driver_user_id is null or coalesce(new.price,0)<=0 then return new; end if;
 -- Prevent replayed delivery/payment transitions from reapplying weekly rental totals
 -- or creating another payout after a prior delivery event has already been credited.
 if exists (
   select 1 from public.driver_earnings_ledger
   where waybill=new.waybill
     and event_key in ('delivery-earning:'||new.waybill,'fleet-driver-share:'||new.waybill)
 ) or exists (
   select 1 from public.fleet_wallet_ledger
   where waybill=new.waybill
     and event_key in ('fleet-share:'||new.waybill,'fleet-rental:'||new.waybill)
 ) or exists (
   select 1 from public.fleet_payout_transfers where waybill=new.waybill
 ) then return new; end if;
 v_gross:=round(new.price*100)::bigint;
 v_platform:=round(v_gross*0.25)::bigint;
 v_net:=v_gross-v_platform;
 select c.* into v_contract
 from public.fleet_driver_contracts c
 join public.fleet_vehicles v on v.fleet_id=c.fleet_id and v.assigned_driver_id=c.driver_id and v.is_active
 where c.driver_id=new.driver_user_id and c.is_active
 order by c.updated_at desc limit 1 for update of c;
 if not found then
   insert into public.driver_earnings_ledger(driver_user_id,event_key,event_type,amount_cents,waybill,description)
   values(new.driver_user_id,'delivery-earning:'||new.waybill,'earning',v_net,new.waybill,
    'Driver share after 25% SwiftHaul platform commission')
   on conflict(event_key) do nothing;
   return new;
 end if;
 select f.owner_user_id,f.paystack_recipient_code into v_owner,v_owner_recipient
 from public.fleets f where f.id=v_contract.fleet_id and f.is_active;
 select paystack_recipient_code into v_driver_recipient from public.driver_profiles where user_id=new.driver_user_id;
 if v_contract.payout_model='percentage_split' then
   v_fleet:=round(v_net*v_contract.fleet_percentage/100)::bigint;
   v_driver:=v_net-v_fleet;
   insert into public.fleet_wallet_ledger(fleet_id,contract_id,waybill,event_key,entry_type,amount_cents,description)
   values(v_contract.fleet_id,v_contract.id,new.waybill,'fleet-share:'||new.waybill,'percentage_share',v_fleet,'Fleet share after platform commission')
   on conflict(event_key) do nothing;
 else
   v_week:=date_trunc('week',now())::date;
   if v_contract.week_start_date<>v_week then
     update public.fleet_driver_contracts set current_week_collected_zar=0,week_start_date=v_week where id=v_contract.id;
     v_contract.current_week_collected_zar:=0;
   end if;
   v_remaining:=greatest(0,round((v_contract.weekly_rental_target_zar-v_contract.current_week_collected_zar)*100)::bigint);
   v_fleet:=least(v_net,v_remaining);
   v_driver:=v_net-v_fleet;
   update public.fleet_driver_contracts set current_week_collected_zar=current_week_collected_zar+(v_fleet::numeric/100),updated_at=now() where id=v_contract.id;
   if v_fleet>0 then
    insert into public.fleet_wallet_ledger(fleet_id,contract_id,waybill,event_key,entry_type,amount_cents,description)
    values(v_contract.fleet_id,v_contract.id,new.waybill,'fleet-rental:'||new.waybill,'weekly_rental_collection',v_fleet,'Weekly rental target collection')
    on conflict(event_key) do nothing;
   end if;
 end if;
 if v_driver>0 then
   insert into public.driver_earnings_ledger(driver_user_id,event_key,event_type,amount_cents,waybill,description)
   values(new.driver_user_id,'fleet-driver-share:'||new.waybill,'earning',v_driver,new.waybill,'Driver share after platform commission and fleet contract')
   on conflict(event_key) do nothing;
 end if;
 if v_fleet>0 then
   insert into public.fleet_payout_transfers(waybill,fleet_id,beneficiary_type,beneficiary_user_id,recipient_code,amount_cents,reference,status)
   values(new.waybill,v_contract.fleet_id,'fleet_owner',v_owner,v_owner_recipient,v_fleet,
    'sh-fleet-'||replace(new.waybill,' ','-'),'queued')
   on conflict(waybill,beneficiary_type) do nothing;
 end if;
 if v_driver>0 then
   insert into public.fleet_payout_transfers(waybill,fleet_id,beneficiary_type,beneficiary_user_id,recipient_code,amount_cents,reference,status)
   values(new.waybill,v_contract.fleet_id,'driver',new.driver_user_id,v_driver_recipient,v_driver,
    'sh-driver-'||replace(new.waybill,' ','-'),'queued')
   on conflict(waybill,beneficiary_type) do nothing;
 end if;
 update public.fleet_payout_transfers set status='needs_recipient',updated_at=now()
 where waybill=new.waybill and recipient_code is null and status='queued';
 return new;
end; $$;
drop trigger if exists credit_driver_earning_after_delivery on public.customer_bookings;
create trigger credit_driver_earning_after_delivery after update of status, paid_at on public.customer_bookings
for each row when(new.status='delivered' and new.paid_at is not null
  and (old.status is distinct from 'delivered' or old.paid_at is null))
execute function public.credit_driver_earning_on_delivery();
revoke all on function public.credit_driver_earning_on_delivery() from public,anon,authenticated;
grant execute on function public.credit_driver_earning_on_delivery() to service_role;

commit;
