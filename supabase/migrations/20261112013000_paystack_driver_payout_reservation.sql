create or replace function public.reserve_paystack_driver_payout(p_driver_id uuid,p_amount_cents bigint,p_reference text)
returns jsonb language plpgsql security definer set search_path='public'
as $$
declare v_balance bigint;v_id uuid;
begin
 if p_driver_id is null or p_amount_cents is null or p_amount_cents<100 or p_amount_cents>100000000 or p_reference !~ '^shp_[a-f0-9]{32}$' then raise exception 'Invalid payout request' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_driver_id::text,0));
 if not exists(select 1 from public.user_profiles where id=p_driver_id and role='driver' and account_status='active') or not exists(select 1 from public.driver_profiles where user_id=p_driver_id and verification_status='approved' and can_go_online=true and paystack_recipient_code is not null) then raise exception 'Approved driver with verified Paystack recipient required' using errcode='42501'; end if;
 select coalesce(sum(amount_cents),0) into v_balance from public.driver_earnings_ledger where driver_user_id=p_driver_id;
 if p_amount_cents>v_balance then raise exception 'Insufficient available earnings' using errcode='22023'; end if;
 insert into public.driver_payouts(driver_id,amount_zar,reference,status) values(p_driver_id,p_amount_cents/100.0,p_reference,'pending') returning id into v_id;
 insert into public.driver_earnings_ledger(driver_user_id,event_key,event_type,amount_cents,description)
 values(p_driver_id,'paystack-payout-reserve:'||p_reference,'payout_reserved',-p_amount_cents,'Reserved for Paystack EFT payout '||p_reference);
 return jsonb_build_object('id',v_id,'amount_cents',p_amount_cents,'reference',p_reference,'status','pending');
end $$;
revoke all on function public.reserve_paystack_driver_payout(uuid,bigint,text) from public,anon,authenticated;
grant execute on function public.reserve_paystack_driver_payout(uuid,bigint,text) to service_role;
create or replace function public.apply_paystack_payout_event(p_reference text,p_status text,p_transfer_code text default null,p_failure_reason text default null)
returns boolean language plpgsql security definer set search_path='public'
as $$
declare p public.driver_payouts%rowtype;v_cents bigint;
begin
 if p_status not in('success','failed') then raise exception 'Invalid payout status'; end if;
 select * into p from public.driver_payouts where reference=p_reference for update;
 if not found then return false; end if;
 if p.status='success' or p.status='failed' then return p.status=p_status; end if;
 update public.driver_payouts set status=p_status,paystack_transfer_code=coalesce(p_transfer_code,paystack_transfer_code),failure_reason=case when p_status='failed' then left(coalesce(p_failure_reason,'Transfer failed'),500) else null end,updated_at=now(),completed_at=now() where id=p.id;
 if p_status='failed' then
  v_cents:=round(p.amount_zar*100)::bigint;
  insert into public.driver_earnings_ledger(driver_user_id,event_key,event_type,amount_cents,description)
  values(p.driver_id,'paystack-payout-reversal:'||p_reference,'payout_reversal',v_cents,'Reversal of failed Paystack EFT payout '||p_reference)
  on conflict(event_key) do nothing;
 end if;
 return true;
end $$;
revoke all on function public.apply_paystack_payout_event(text,text,text,text) from public,anon,authenticated;
grant execute on function public.apply_paystack_payout_event(text,text,text,text) to service_role;