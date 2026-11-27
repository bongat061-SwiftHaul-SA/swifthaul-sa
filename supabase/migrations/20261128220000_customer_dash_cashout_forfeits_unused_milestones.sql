alter table public.customer_dash_milestones
  drop constraint if exists customer_dash_milestones_status_check;
alter table public.customer_dash_milestones
  add constraint customer_dash_milestones_status_check
  check (status in ('pending','approved','rejected','redeemed','forfeited'));

create or replace function public.customer_dash_review_cashout(
  p_cashout_id uuid,
  p_admin_id uuid,
  p_decision text,
  p_payout_reference text,
  p_note text
) returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  c public.customer_dash_cashouts%rowtype;
  forfeited_count integer := 0;
begin
  if p_decision not in ('paid','reject') then
    raise exception 'invalid_cashout_decision';
  end if;
  select * into c from public.customer_dash_cashouts where id=p_cashout_id for update;
  if not found or c.status<>'pending' then raise exception 'cashout_not_pending'; end if;
  if p_decision='paid' then
    if nullif(trim(coalesce(p_payout_reference,'')),'') is null then raise exception 'payout_reference_required'; end if;
    update public.customer_dash_cashouts
      set status='paid',admin_user_id=p_admin_id,payout_reference=left(p_payout_reference,120),
          admin_note=nullif(left(coalesce(p_note,''),500),''),reviewed_at=now()
      where id=p_cashout_id;
    update public.customer_dash_milestones
      set status='forfeited',
          admin_note=concat_ws(' · ',nullif(admin_note,''),'Unused points forfeited after R150 cash-out'),
          reviewed_at=coalesce(reviewed_at,now())
      where user_id=c.user_id and status in ('pending','approved');
    get diagnostics forfeited_count = row_count;
    update public.customer_dash_rewards
      set available_points=0,cycle_points=0,cycle_number=cycle_number+1,updated_at=now()
      where user_id=c.user_id;
  else
    update public.customer_dash_cashouts
      set status='rejected',admin_user_id=p_admin_id,
          admin_note=nullif(left(coalesce(p_note,''),500),''),reviewed_at=now()
      where id=p_cashout_id;
  end if;
  return jsonb_build_object('ok',true,'status',case when p_decision='paid' then 'paid' else 'rejected' end,
    'forfeited_milestones',forfeited_count);
end;
$$;
revoke all on function public.customer_dash_review_cashout(uuid,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.customer_dash_review_cashout(uuid,uuid,text,text,text) to service_role;
