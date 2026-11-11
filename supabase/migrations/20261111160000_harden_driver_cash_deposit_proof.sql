-- Cash-deposit proof uploads must come from a currently active, approved Driver.
create or replace function public.submit_driver_cash_deposit_proof(
  p_deposit_id uuid,
  p_proof_object text,
  p_driver_note text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_driver uuid := auth.uid();
  v_deposit public.driver_cash_deposits%rowtype;
begin
  if v_driver is null
     or not exists (
       select 1 from public.user_profiles
       where id=v_driver and role='driver' and account_status='active'
     )
     or not exists (
       select 1 from public.driver_profiles
       where user_id=v_driver and verification_status='approved'
     ) then
    raise exception 'Approved active driver required' using errcode='42501';
  end if;

  if p_deposit_id is null or p_proof_object is null
    or p_proof_object not like v_driver::text || '/%'
    or length(trim(p_proof_object)) not between 3 and 500
    or not exists (
      select 1 from storage.objects so
      where so.bucket_id='driver-cash-deposit-proofs' and so.name=trim(p_proof_object)
    )
    or (p_driver_note is not null and length(p_driver_note)>500) then
    raise exception 'Valid deposit proof is required' using errcode='22023';
  end if;

  update public.driver_cash_deposits
    set proof_object=trim(p_proof_object),
        driver_note=nullif(trim(p_driver_note),''),
        status='proof_submitted',
        updated_at=now()
    where id=p_deposit_id
      and driver_user_id=v_driver
      and status='awaiting_deposit'
    returning * into v_deposit;

  if not found then
    raise exception 'Pending deposit instruction not found' using errcode='P0002';
  end if;

  return jsonb_build_object('id',v_deposit.id,'reference',v_deposit.reference,'status',v_deposit.status);
end;
$$;

revoke all on function public.submit_driver_cash_deposit_proof(uuid,text,text) from public, anon;
grant execute on function public.submit_driver_cash_deposit_proof(uuid,text,text) to authenticated;
