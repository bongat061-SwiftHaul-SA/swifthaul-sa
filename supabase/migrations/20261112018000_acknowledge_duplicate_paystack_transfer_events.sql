create or replace function public.apply_paystack_payout_event(p_reference text,p_status text,p_transfer_code text default null,p_failure_reason text default null)
returns boolean language plpgsql security definer set search_path='public'
as $$
declare p public.driver_payouts%rowtype;v_cents bigint;
begin
 if p_status not in('success','failed') then raise exception 'Invalid payout status'; end if;
 select * into p from public.driver_payouts where reference=p_reference for update;
 if not found then return false; end if;
 if p.status in('success','failed') then return true; end if;
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