-- Daily verified-play and five-day streak bonuses for authenticated Customer Dash.
create table if not exists public.customer_dash_bonus_days (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  play_date date not null,
  streak_day integer not null check (streak_day between 1 and 100000),
  daily_bonus_points integer not null default 50 check (daily_bonus_points = 50),
  streak_bonus_points integer not null default 0 check (streak_bonus_points in (0,25)),
  created_at timestamptz not null default now(),
  unique(user_id, play_date)
);
alter table public.customer_dash_bonus_days enable row level security;
revoke all on public.customer_dash_bonus_days from public, anon, authenticated;
grant all on public.customer_dash_bonus_days to service_role;

create or replace function public.customer_dash_submit_round(p_user_id uuid,p_round_id uuid,p_score integer)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
 r public.customer_dash_rounds%rowtype;
 p public.customer_dash_rewards%rowtype;
 local_day date := (now() at time zone 'Africa/Johannesburg')::date;
 prev_streak integer := 0;
 streak integer := 1;
 daily_bonus integer := 0;
 streak_bonus integer := 0;
 earned integer := 0;
 n integer;
begin
 if p_score<0 or p_score>460 then raise exception 'score_out_of_range'; end if;
 select * into r from public.customer_dash_rounds where id=p_round_id and user_id=p_user_id for update;
 if not found or r.status<>'started' then raise exception 'round_not_valid'; end if;
 if now()<r.started_at+interval '25 seconds' then raise exception 'round_too_short'; end if;
 if now()>r.expires_at then update public.customer_dash_rounds set status='expired' where id=p_round_id; raise exception 'round_expired'; end if;
 insert into public.customer_dash_rewards(user_id) values(p_user_id) on conflict(user_id) do nothing;
 select * into p from public.customer_dash_rewards where user_id=p_user_id for update;
 if exists(select 1 from public.customer_dash_cashouts where user_id=p_user_id and status='pending') then raise exception 'cashout_pending'; end if;
 if not exists(select 1 from public.customer_dash_bonus_days where user_id=p_user_id and play_date=local_day) then
   select streak_day into prev_streak from public.customer_dash_bonus_days where user_id=p_user_id and play_date=local_day-1;
   if found then streak:=prev_streak+1; else streak:=1; end if;
   daily_bonus:=50;
   if streak % 5 = 0 then streak_bonus:=25; end if;
   insert into public.customer_dash_bonus_days(user_id,play_date,streak_day,daily_bonus_points,streak_bonus_points)
    values(p_user_id,local_day,streak,daily_bonus,streak_bonus) on conflict(user_id,play_date) do nothing;
   if not found then daily_bonus:=0; streak_bonus:=0; end if;
 end if;
 earned:=p_score+daily_bonus+streak_bonus;
 n:=least(5000,p.cycle_points+earned);
 update public.customer_dash_rewards set lifetime_points=lifetime_points+earned,cycle_points=n,
 available_points=available_points+earned,best_score=greatest(best_score,p_score),updated_at=now()
 where user_id=p_user_id returning * into p;
 update public.customer_dash_rounds set status='submitted',submitted_at=now(),score=p_score,cycle_number=p.cycle_number where id=p_round_id;
 if n>=1000 then insert into public.customer_dash_milestones(user_id,cycle_number,milestone_points,reward_cents) values(p_user_id,p.cycle_number,1000,1000) on conflict do nothing; end if;
 if n>=2500 then insert into public.customer_dash_milestones(user_id,cycle_number,milestone_points,reward_cents) values(p_user_id,p.cycle_number,2500,2000) on conflict do nothing; end if;
 if n>=5000 then insert into public.customer_dash_milestones(user_id,cycle_number,milestone_points,reward_cents) values(p_user_id,p.cycle_number,5000,4000) on conflict do nothing; end if;
 return jsonb_build_object('lifetime_points',p.lifetime_points,'available_points',p.available_points,
  'points_spent',p.points_spent,'cycle_points',p.cycle_points,'cycle_number',p.cycle_number,
  'best_score',p.best_score,'round_score',p_score,'daily_bonus_points',daily_bonus,
  'streak_bonus_points',streak_bonus,'streak_day',case when daily_bonus>0 then streak else null end,
  'points_earned_this_round',earned);
end $$;
revoke all on function public.customer_dash_submit_round(uuid,uuid,integer) from public,anon,authenticated;
grant execute on function public.customer_dash_submit_round(uuid,uuid,integer) to service_role;
