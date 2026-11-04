create unique index if not exists driver_payout_one_open_request_per_driver
on public.driver_payout_requests(driver_user_id)
where status in ('pending','approved');

create or replace function public.request_driver_payout(
 p_driver_id uuid,p_amount_cents bigint,p_bank_name text,p_account_holder text,
 p_account_number text,p_account_type text,p_branch_code text default null
) returns jsonb
language plpgsql
set search_path to 'public'
as $function$
declare v_balance bigint; v_req public.driver_payout_requests%rowtype;
begin
 if p_driver_id is null or p_amount_cents is null or p_amount_cents<1000
  or p_bank_name is null or length(trim(p_bank_name)) not between 2 and 100
  or p_account_holder is null or length(trim(p_account_holder)) not between 2 and 120
  or p_account_number is null or p_account_number !~ '^[0-9]{6,20}$'
  or p_account_type is null or p_account_type not in ('cheque','current','savings','transmission','other')
  or (p_branch_code is not null and p_branch_code !~ '^[0-9]{6}$') then
  raise exception 'Invalid payout details' using errcode='22023';
 end if;
 perform pg_advisory_xact_lock(hashtextextended(p_driver_id::text,0));
 if not exists(select 1 from public.user_profiles where id=p_driver_id and role='driver' and account_status='active')
  or not exists(select 1 from public.driver_profiles where user_id=p_driver_id and verification_status='approved') then
  raise exception 'Approved active driver required' using errcode='42501';
 end if;
 if exists(select 1 from public.driver_payout_requests where driver_user_id=p_driver_id and status in ('pending','approved')) then
  raise exception 'An open payout request already exists' using errcode='23505';
 end if;
 select coalesce(sum(amount_cents),0) into v_balance from public.driver_earnings_ledger where driver_user_id=p_driver_id;
 if p_amount_cents>v_balance then raise exception 'Insufficient available earnings' using errcode='22023'; end if;
 insert into public.driver_payout_requests(driver_user_id,amount_cents,bank_name,account_holder,account_number,account_type,branch_code)
 values(p_driver_id,p_amount_cents,trim(p_bank_name),trim(p_account_holder),p_account_number,p_account_type,p_branch_code)
 returning * into v_req;
 insert into public.driver_earnings_ledger(driver_user_id,event_key,event_type,amount_cents,payout_request_id,description)
 values(p_driver_id,'payout-reserve:'||v_req.id,'payout_reserved',-p_amount_cents,v_req.id,'Reserved for payout request '||v_req.id);
 return jsonb_build_object('id',v_req.id,'amount_cents',v_req.amount_cents,'status',v_req.status,'created_at',v_req.created_at);
end; $function$;

revoke all on function public.request_driver_payout(uuid,bigint,text,text,text,text,text) from public,anon,authenticated;
grant execute on function public.request_driver_payout(uuid,bigint,text,text,text,text,text) to service_role;