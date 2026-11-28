-- Keep voucher-claim queues consistent when an R150 Dash Rewards cash-out is paid.
CREATE OR REPLACE FUNCTION public.customer_dash_review_cashout(
  p_cashout_id uuid,
  p_admin_id uuid,
  p_decision text,
  p_payout_reference text,
  p_note text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  c public.customer_dash_cashouts%rowtype;
  forfeited_count integer := 0;
begin
  if p_decision not in ('paid','reject') then
    raise exception 'invalid_cashout_decision';
  end if;

  select * into c
  from public.customer_dash_cashouts
  where id=p_cashout_id
  for update;

  if not found or c.status<>'pending' then
    raise exception 'cashout_not_pending';
  end if;

  if p_decision='paid' then
    if nullif(trim(coalesce(p_payout_reference,'')),'') is null then
      raise exception 'payout_reference_required';
    end if;

    update public.customer_dash_cashouts
    set status='paid',
        admin_user_id=p_admin_id,
        payout_reference=left(p_payout_reference,120),
        admin_note=nullif(left(coalesce(p_note,''),500),''),
        reviewed_at=now()
    where id=p_cashout_id;

    -- Close any voucher claim that can no longer be fulfilled after cash-out.
    update public.customer_dash_admin_notifications n
    set resolved_at=now()
    where n.notification_type='voucher_claim'
      and n.resolved_at is null
      and n.related_id in (
        select m.id
        from public.customer_dash_milestones m
        where m.user_id=c.user_id
          and m.status in ('pending','approved')
      );

    -- Forfeit all unredeemed milestones and explicitly close pending claims.
    update public.customer_dash_milestones
    set status='forfeited',
        claim_status=case when claim_status='pending' then 'forfeited' else claim_status end,
        claim_reviewed_by=case when claim_status='pending' then p_admin_id else claim_reviewed_by end,
        claim_reviewed_at=case when claim_status='pending' then now() else claim_reviewed_at end,
        claim_admin_note=case when claim_status='pending'
          then 'Closed because the R150 cash-out was paid; unused points were forfeited'
          else claim_admin_note end,
        admin_note=concat_ws(' · ',nullif(admin_note,''),'Unused points forfeited after R150 cash-out'),
        reviewed_at=coalesce(reviewed_at,now())
    where user_id=c.user_id
      and status in ('pending','approved');
    get diagnostics forfeited_count = row_count;

    update public.customer_dash_rewards
    set available_points=0,
        cycle_points=0,
        cycle_number=cycle_number+1,
        updated_at=now()
    where user_id=c.user_id;
  else
    update public.customer_dash_cashouts
    set status='rejected',
        admin_user_id=p_admin_id,
        admin_note=nullif(left(coalesce(p_note,''),500),''),
        reviewed_at=now()
    where id=p_cashout_id;
  end if;

  return jsonb_build_object(
    'ok',true,
    'status',case when p_decision='paid' then 'paid' else 'rejected' end,
    'forfeited_milestones',forfeited_count
  );
end;
$function$;
