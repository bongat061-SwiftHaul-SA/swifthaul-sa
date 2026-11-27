-- Persistent unused-point balance, single-use coupons and Admin-controlled R150 cash-out.
alter table public.customer_dash_rewards
  add column if not exists available_points integer not null default 0 check (available_points >= 0),
  add column if not exists points_spent integer not null default 0 check (points_spent >= 0);
update public.customer_dash_rewards set available_points=greatest(available_points,cycle_points) where available_points=0;
create table if not exists public.customer_dash_cashouts (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 points_snapshot integer not null check(points_snapshot>=25000), amount_cents integer not null default 15000 check(amount_cents=15000),
 status text not null default 'pending' check(status in('pending','paid','rejected')),
 admin_user_id uuid references auth.users(id), admin_note text, payout_reference text,
 requested_at timestamptz not null default now(), reviewed_at timestamptz
);
create unique index if not exists customer_dash_one_pending_cashout on public.customer_dash_cashouts(user_id) where status='pending';
alter table public.customer_dash_cashouts enable row level security;
revoke all on public.customer_dash_cashouts from anon,authenticated;
grant all on public.customer_dash_cashouts to service_role;
create or replace function public.customer_dash_submit_round(p_user_id uuid,p_round_id uuid,p_score integer)
returns jsonb language plpgsql security definer set search_path=public as $$
declare r public.customer_dash_rounds%rowtype; p public.customer_dash_rewards%rowtype; n integer;
begin
 if p_score<0 or p_score>460 then raise exception 'score_out_of_range'; end if;
 select * into r from public.customer_dash_rounds where id=p_round_id and user_id=p_user_id for update;
 if not found or r.status<>'started' then raise exception 'round_not_valid'; end if;
 if now()<r.started_at+interval '25 seconds' then raise exception 'round_too_short'; end if;
 if now()>r.expires_at then update public.customer_dash_rounds set status='expired' where id=p_round_id; raise exception 'round_expired'; end if;
 insert into public.customer_dash_rewards(user_id) values(p_user_id) on conflict(user_id) do nothing;
 select * into p from public.customer_dash_rewards where user_id=p_user_id for update;
 if exists(select 1 from public.customer_dash_cashouts where user_id=p_user_id and status='pending') then raise exception 'cashout_pending'; end if;
 n:=least(5000,p.cycle_points+p_score);
 update public.customer_dash_rewards set lifetime_points=lifetime_points+p_score,cycle_points=n,
 available_points=available_points+p_score,best_score=greatest(best_score,p_score),updated_at=now()
 where user_id=p_user_id returning * into p;
 update public.customer_dash_rounds set status='submitted',submitted_at=now(),score=p_score,cycle_number=p.cycle_number where id=p_round_id;
 if n>=1000 then insert into public.customer_dash_milestones(user_id,cycle_number,milestone_points,reward_cents) values(p_user_id,p.cycle_number,1000,1000) on conflict do nothing; end if;
 if n>=2500 then insert into public.customer_dash_milestones(user_id,cycle_number,milestone_points,reward_cents) values(p_user_id,p.cycle_number,2500,2000) on conflict do nothing; end if;
 if n>=5000 then insert into public.customer_dash_milestones(user_id,cycle_number,milestone_points,reward_cents) values(p_user_id,p.cycle_number,5000,4000) on conflict do nothing; end if;
 return jsonb_build_object('lifetime_points',p.lifetime_points,'available_points',p.available_points,'points_spent',p.points_spent,'cycle_points',p.cycle_points,'cycle_number',p.cycle_number,'best_score',p.best_score);
end $$;
create or replace function public.customer_dash_redeem_coupon(p_user_id uuid,p_milestone_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare m public.customer_dash_milestones%rowtype; p public.customer_dash_rewards%rowtype;
begin
 select * into m from public.customer_dash_milestones where id=p_milestone_id and user_id=p_user_id for update;
 if not found or m.status<>'approved' or m.voucher_code is null then raise exception 'coupon_not_redeemable'; end if;
 select * into p from public.customer_dash_rewards where user_id=p_user_id for update;
 if not found or p.available_points<m.milestone_points then raise exception 'insufficient_available_points'; end if;
 if exists(select 1 from public.customer_dash_cashouts where user_id=p_user_id and status='pending') then raise exception 'cashout_pending'; end if;
 update public.customer_dash_rewards set available_points=available_points-m.milestone_points,points_spent=points_spent+m.milestone_points,updated_at=now()
 where user_id=p_user_id returning * into p;
 update public.customer_dash_milestones set status='redeemed' where id=p_milestone_id;
 return jsonb_build_object('ok',true,'voucher_code',m.voucher_code,'discount_cents',m.reward_cents,'available_points',p.available_points,'points_spent',p.points_spent);
end $$;
create or replace function public.customer_dash_request_cashout(p_user_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare p public.customer_dash_rewards%rowtype; c public.customer_dash_cashouts%rowtype;
begin
 select * into p from public.customer_dash_rewards where user_id=p_user_id for update;
 if not found or p.available_points<25000 then raise exception 'cashout_threshold_not_met'; end if;
 insert into public.customer_dash_cashouts(user_id,points_snapshot) values(p_user_id,p.available_points) returning * into c;
 return jsonb_build_object('ok',true,'cashout_id',c.id,'status',c.status,'amount_cents',c.amount_cents,'points_snapshot',c.points_snapshot);
exception when unique_violation then raise exception 'cashout_already_pending';
end $$;
create or replace function public.customer_dash_review_cashout(p_cashout_id uuid,p_admin_id uuid,p_decision text,p_payout_reference text,p_note text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare c public.customer_dash_cashouts%rowtype;
begin
 if p_decision not in('paid','reject') then raise exception 'invalid_cashout_decision'; end if;
 select * into c from public.customer_dash_cashouts where id=p_cashout_id for update;
 if not found or c.status<>'pending' then raise exception 'cashout_not_pending'; end if;
 if p_decision='paid' then
  if nullif(trim(coalesce(p_payout_reference,'')),'') is null then raise exception 'payout_reference_required'; end if;
  update public.customer_dash_cashouts set status='paid',admin_user_id=p_admin_id,payout_reference=left(p_payout_reference,120),admin_note=nullif(left(coalesce(p_note,''),500),''),reviewed_at=now() where id=p_cashout_id;
  update public.customer_dash_rewards set available_points=0,cycle_points=0,cycle_number=cycle_number+1,updated_at=now() where user_id=c.user_id;
 else
  update public.customer_dash_cashouts set status='rejected',admin_user_id=p_admin_id,admin_note=nullif(left(coalesce(p_note,''),500),''),reviewed_at=now() where id=p_cashout_id;
 end if;
 return jsonb_build_object('ok',true,'status',case when p_decision='paid' then 'paid' else 'rejected' end);
end $$;
revoke all on function public.customer_dash_redeem_coupon(uuid,uuid) from public,anon,authenticated;
revoke all on function public.customer_dash_request_cashout(uuid) from public,anon,authenticated;
revoke all on function public.customer_dash_review_cashout(uuid,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.customer_dash_redeem_coupon(uuid,uuid) to service_role;
grant execute on function public.customer_dash_request_cashout(uuid) to service_role;
grant execute on function public.customer_dash_review_cashout(uuid,uuid,text,text,text) to service_role;