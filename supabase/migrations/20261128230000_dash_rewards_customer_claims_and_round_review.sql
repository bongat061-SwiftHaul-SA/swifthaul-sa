-- Correct Dash Rewards ownership: Admin verifies submitted rounds; customers claim rewards.
alter table public.customer_dash_rounds drop constraint if exists customer_dash_rounds_status_check;
alter table public.customer_dash_rounds add constraint customer_dash_rounds_status_check
  check (status in ('started','submitted','approved','expired','rejected','legacy_credited'));
alter table public.customer_dash_rounds
  add column if not exists reviewed_by uuid references auth.users(id),
  add column if not exists reviewed_at timestamptz,
  add column if not exists review_note text;

-- Preserve points already credited by the old implementation without double-crediting.
update public.customer_dash_rounds set status='legacy_credited'
where status='submitted' and submitted_at is not null;
update public.customer_dash_milestones set status='approved' where status='pending';

create table if not exists public.customer_dash_admin_notifications (
  id uuid primary key default gen_random_uuid(),
  notification_type text not null check (notification_type in ('voucher_claim','cashout_request')),
  title text not null, message text not null,
  customer_user_id uuid not null references auth.users(id) on delete cascade,
  related_id uuid not null, created_at timestamptz not null default now(),
  read_at timestamptz, resolved_at timestamptz
);
create index if not exists customer_dash_admin_notifications_unresolved_idx
  on public.customer_dash_admin_notifications(created_at desc) where resolved_at is null;
alter table public.customer_dash_admin_notifications enable row level security;
revoke all on public.customer_dash_admin_notifications from anon, authenticated;
grant all on public.customer_dash_admin_notifications to service_role;

create or replace function public.customer_dash_submit_round(p_user_id uuid,p_round_id uuid,p_score integer)
returns jsonb language plpgsql security definer set search_path=public as $$
declare r public.customer_dash_rounds%rowtype; p public.customer_dash_rewards%rowtype;
begin
 if p_score<0 or p_score>460 then raise exception 'score_out_of_range'; end if;
 select * into r from public.customer_dash_rounds where id=p_round_id and user_id=p_user_id for update;
 if not found or r.status<>'started' then raise exception 'round_not_valid'; end if;
 if now()<r.started_at+interval '25 seconds' then raise exception 'round_too_short'; end if;
 if now()>r.expires_at then update public.customer_dash_rounds set status='expired' where id=p_round_id; raise exception 'round_expired'; end if;
 if exists(select 1 from public.customer_dash_cashouts where user_id=p_user_id and status='pending') then raise exception 'cashout_pending'; end if;
 insert into public.customer_dash_rewards(user_id) values(p_user_id) on conflict(user_id) do nothing;
 select * into p from public.customer_dash_rewards where user_id=p_user_id for update;
 update public.customer_dash_rounds set status='submitted',submitted_at=now(),score=p_score,cycle_number=p.cycle_number where id=p_round_id;
 return jsonb_build_object('ok',true,'status','submitted','pending_admin_review',true,'score',p_score,
   'cycle_number',p.cycle_number,'lifetime_points',p.lifetime_points,
   'available_points',p.available_points,'cycle_points',p.cycle_points,'best_score',p.best_score);
end $$;

create or replace function public.customer_dash_review_round(p_round_id uuid,p_admin_id uuid,p_decision text,p_note text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
 r public.customer_dash_rounds%rowtype; p public.customer_dash_rewards%rowtype;
 local_day date := (now() at time zone 'Africa/Johannesburg')::date;
 prev_streak integer := 0; streak integer := 1; daily_bonus integer := 0;
 streak_bonus integer := 0; earned integer := 0; n integer := 0;
begin
 if p_decision not in ('approve','reject') then raise exception 'invalid_decision'; end if;
 select * into r from public.customer_dash_rounds where id=p_round_id for update;
 if not found or r.status<>'submitted' then raise exception 'round_not_pending'; end if;
 if p_decision='reject' then
   update public.customer_dash_rounds set status='rejected',reviewed_by=p_admin_id,reviewed_at=now(),
     review_note=nullif(left(coalesce(p_note,''),500),'') where id=p_round_id;
   return jsonb_build_object('ok',true,'status','rejected','points_credited',0);
 end if;
 if exists(select 1 from public.customer_dash_cashouts where user_id=r.user_id and status='pending') then
   raise exception 'customer_cashout_pending';
 end if;
 insert into public.customer_dash_rewards(user_id) values(r.user_id) on conflict(user_id) do nothing;
 select * into p from public.customer_dash_rewards where user_id=r.user_id for update;
 if not exists(select 1 from public.customer_dash_bonus_days where user_id=r.user_id and play_date=local_day) then
   select streak_day into prev_streak from public.customer_dash_bonus_days where user_id=r.user_id and play_date=local_day-1;
   if found then streak:=prev_streak+1; else streak:=1; end if;
   daily_bonus:=50; if streak % 5 = 0 then streak_bonus:=25; end if;
   insert into public.customer_dash_bonus_days(user_id,play_date,streak_day,daily_bonus_points,streak_bonus_points)
    values(r.user_id,local_day,streak,daily_bonus,streak_bonus) on conflict(user_id,play_date) do nothing;
   if not found then daily_bonus:=0; streak_bonus:=0; end if;
 end if;
 earned:=coalesce(r.score,0)+daily_bonus+streak_bonus;
 n:=least(5000,p.cycle_points+earned);
 update public.customer_dash_rewards set lifetime_points=lifetime_points+earned,cycle_points=n,
   available_points=available_points+earned,best_score=greatest(best_score,coalesce(r.score,0)),updated_at=now()
   where user_id=r.user_id returning * into p;
 update public.customer_dash_rounds set status='approved',reviewed_by=p_admin_id,reviewed_at=now(),
   review_note=nullif(left(coalesce(p_note,''),500),'') where id=p_round_id;
 if n>=1000 then
  insert into public.customer_dash_milestones(user_id,cycle_number,milestone_points,reward_cents,status)
  values(r.user_id,p.cycle_number,1000,1000,'approved') on conflict(user_id,cycle_number,milestone_points) do nothing;
 end if;
 if n>=2500 then
  insert into public.customer_dash_milestones(user_id,cycle_number,milestone_points,reward_cents,status)
  values(r.user_id,p.cycle_number,2500,2000,'approved') on conflict(user_id,cycle_number,milestone_points) do nothing;
 end if;
 if n>=5000 then
  insert into public.customer_dash_milestones(user_id,cycle_number,milestone_points,reward_cents,status)
  values(r.user_id,p.cycle_number,5000,4000,'approved') on conflict(user_id,cycle_number,milestone_points) do nothing;
  update public.customer_dash_rewards set cycle_points=0,cycle_number=cycle_number+1,updated_at=now()
   where user_id=r.user_id returning * into p;
 end if;
 return jsonb_build_object('ok',true,'status','approved','points_credited',earned,'daily_bonus_points',daily_bonus,
  'streak_bonus_points',streak_bonus,'lifetime_points',p.lifetime_points,'available_points',p.available_points,
  'cycle_points',p.cycle_points,'cycle_number',p.cycle_number,'best_score',p.best_score);
end $$;

create or replace function public.customer_dash_redeem_coupon(p_user_id uuid,p_milestone_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare m public.customer_dash_milestones%rowtype; p public.customer_dash_rewards%rowtype; code text;
begin
 select * into m from public.customer_dash_milestones where id=p_milestone_id and user_id=p_user_id for update;
 if not found or m.status<>'approved' then raise exception 'coupon_not_claimable'; end if;
 select * into p from public.customer_dash_rewards where user_id=p_user_id for update;
 if not found or p.available_points<m.milestone_points then raise exception 'insufficient_available_points'; end if;
 if exists(select 1 from public.customer_dash_cashouts where user_id=p_user_id and status='pending') then raise exception 'cashout_pending'; end if;
 code:=coalesce(m.voucher_code,'DASH-'||upper(substr(encode(gen_random_bytes(6),'hex'),1,10)));
 update public.customer_dash_rewards set available_points=available_points-m.milestone_points,
  points_spent=points_spent+m.milestone_points,updated_at=now() where user_id=p_user_id returning * into p;
 update public.customer_dash_milestones set status='redeemed',voucher_code=code where id=p_milestone_id;
 insert into public.customer_dash_admin_notifications(notification_type,title,message,customer_user_id,related_id)
 values('voucher_claim','Customer claimed a Dash Rewards voucher',
  'A customer claimed a R'||(m.reward_cents/100)::text||' Dash Rewards voucher ('||m.milestone_points::text||' points). Review the claim in Admin.',
  p_user_id,p_milestone_id);
 return jsonb_build_object('ok',true,'voucher_code',code,'discount_cents',m.reward_cents,
  'available_points',p.available_points,'points_spent',p.points_spent);
end $$;

create or replace function public.customer_dash_request_cashout(p_user_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare p public.customer_dash_rewards%rowtype; c public.customer_dash_cashouts%rowtype;
begin
 select * into p from public.customer_dash_rewards where user_id=p_user_id for update;
 if not found or p.available_points<25000 then raise exception 'cashout_threshold_not_met'; end if;
 insert into public.customer_dash_cashouts(user_id,points_snapshot) values(p_user_id,p.available_points) returning * into c;
 insert into public.customer_dash_admin_notifications(notification_type,title,message,customer_user_id,related_id)
 values('cashout_request','Customer requested R150 Dash Rewards cash-out',
  'A customer requested an R150 cash-out using '||p.available_points::text||' unused points. Review and process the request in Admin.',
  p_user_id,c.id);
 return jsonb_build_object('ok',true,'cashout_id',c.id,'status',c.status,'amount_cents',c.amount_cents,'points_snapshot',c.points_snapshot);
exception when unique_violation then raise exception 'cashout_already_pending';
end $$;

revoke all on function public.customer_dash_submit_round(uuid,uuid,integer) from public,anon,authenticated;
revoke all on function public.customer_dash_review_round(uuid,uuid,text,text) from public,anon,authenticated;
revoke all on function public.customer_dash_redeem_coupon(uuid,uuid) from public,anon,authenticated;
revoke all on function public.customer_dash_request_cashout(uuid) from public,anon,authenticated;
grant execute on function public.customer_dash_submit_round(uuid,uuid,integer) to service_role;
grant execute on function public.customer_dash_review_round(uuid,uuid,text,text) to service_role;
grant execute on function public.customer_dash_redeem_coupon(uuid,uuid) to service_role;
grant execute on function public.customer_dash_request_cashout(uuid) to service_role;
