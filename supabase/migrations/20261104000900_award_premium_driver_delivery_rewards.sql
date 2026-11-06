create or replace function public.award_premium_delivery_rewards()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare v_driver uuid; v_month_start timestamptz; v_month_end timestamptz; v_monthly_rebates bigint; v_rebate bigint; v_margin bigint; v_completed integer; v_subscription_pool bigint; v_at timestamptz;
begin
 if new.status<>'delivered' or old.status='delivered' or new.driver_user_id is null or new.price is null or new.price<=0 then return new; end if;
 v_driver:=new.driver_user_id; v_at:=coalesce(new.completed_at,now());
 if not public.driver_premium_active(v_driver,v_at) then return new; end if;
 v_month_start:=date_trunc('month',v_at at time zone 'Africa/Johannesburg') at time zone 'Africa/Johannesburg';
 v_month_end:=v_month_start+interval '1 month';
 select coalesce(sum(amount_cents),0) into v_monthly_rebates from public.driver_reward_ledger
 where driver_user_id=v_driver and event_type='fuel_rebate' and created_at>=v_month_start and created_at<v_month_end;
 v_margin:=greatest(0,round(new.price*100)::bigint-round(new.price*75)::bigint);
 v_rebate:=least(1500::bigint,greatest(0,45000-v_monthly_rebates),v_margin);
 if v_rebate>0 then
  insert into public.driver_reward_ledger(driver_user_id,event_key,event_type,amount_cents,waybill,period_start,description)
  values(v_driver,'premium-fuel:'||new.waybill,'fuel_rebate',v_rebate,new.waybill,(v_month_start at time zone 'Africa/Johannesburg')::date,'Premium fuel rebate for completed delivery')
  on conflict(event_key) do nothing;
 end if;
 select count(*) into v_completed from public.customer_bookings where driver_user_id=v_driver and status='delivered' and completed_at>=v_month_start and completed_at<v_month_end;
 if v_completed>=10 then
  select coalesce(sum(amount_cents),0) into v_subscription_pool from public.driver_membership_revenue_ledger;
  select v_subscription_pool-coalesce(sum(amount_cents),0) into v_subscription_pool from public.driver_reward_ledger where event_type='milestone_bonus';
  if v_subscription_pool>=50000 then
   insert into public.driver_reward_ledger(driver_user_id,event_key,event_type,amount_cents,period_start,description)
   values(v_driver,'premium-milestone:'||v_driver::text||':'||to_char(v_month_start at time zone 'Africa/Johannesburg','YYYY-MM'),'milestone_bonus',50000,(v_month_start at time zone 'Africa/Johannesburg')::date,'Monthly premium milestone bonus: 10 completed deliveries')
   on conflict(event_key) do nothing;
  end if;
 end if;
 return new;
end; $$;
drop trigger if exists premium_rewards_after_delivery on public.customer_bookings;
create trigger premium_rewards_after_delivery after update of status on public.customer_bookings for each row execute function public.award_premium_delivery_rewards();
revoke all on function public.award_premium_delivery_rewards() from public,anon,authenticated;