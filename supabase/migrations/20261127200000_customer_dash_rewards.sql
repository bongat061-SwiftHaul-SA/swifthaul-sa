-- SwiftHaul Dash Rewards (staging)
-- Rewards accrue only from authenticated, online Customer game sessions.
create table if not exists public.customer_dash_rewards (
 user_id uuid primary key references auth.users(id) on delete cascade,
 lifetime_points integer not null default 0 check(lifetime_points>=0),
 cycle_points integer not null default 0 check(cycle_points>=0 and cycle_points<=5000),
 cycle_number integer not null default 1 check(cycle_number>0),
 best_score integer not null default 0 check(best_score>=0),
 updated_at timestamptz not null default now()
);
create table if not exists public.customer_dash_rounds (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 started_at timestamptz not null default now(),
 expires_at timestamptz not null,
 submitted_at timestamptz,
 score integer check(score is null or(score>=0 and score<=460)),
 cycle_number integer,
 status text not null default 'started' check(status in('started','submitted','expired','rejected')),
 created_at timestamptz not null default now()
);
create unique index if not exists customer_dash_one_active_round_per_user on public.customer_dash_rounds(user_id) where status='started';
create index if not exists customer_dash_rounds_user_created_idx on public.customer_dash_rounds(user_id,created_at desc);
create table if not exists public.customer_dash_milestones (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 cycle_number integer not null,
 milestone_points integer not null check(milestone_points in(1000,2500,5000)),
 reward_cents integer not null check(reward_cents in(1000,2000,4000)),
 status text not null default 'pending' check(status in('pending','approved','rejected','redeemed')),
 voucher_code text unique,
 admin_user_id uuid references auth.users(id),
 admin_note text,
 reviewed_at timestamptz,
 created_at timestamptz not null default now(),
 unique(user_id,cycle_number,milestone_points)
);
create index if not exists customer_dash_milestones_status_idx on public.customer_dash_milestones(status,created_at);
alter table public.customer_dash_rewards enable row level security;
alter table public.customer_dash_rounds enable row level security;
alter table public.customer_dash_milestones enable row level security;
revoke all on public.customer_dash_rewards,public.customer_dash_rounds,public.customer_dash_milestones from anon,authenticated;
grant all on public.customer_dash_rewards,public.customer_dash_rounds,public.customer_dash_milestones to service_role;
create or replace function public.customer_dash_submit_round(p_user_id uuid,p_round_id uuid,p_score integer)
returns jsonb language plpgsql security definer set search_path=public as $$
declare r public.customer_dash_rounds%rowtype; p public.customer_dash_rewards%rowtype; new_points integer;
begin
 if p_score<0 or p_score>460 then raise exception 'score_out_of_range'; end if;
 select * into r from public.customer_dash_rounds where id=p_round_id and user_id=p_user_id for update;
 if not found or r.status<>'started' then raise exception 'round_not_valid'; end if;
 if now()<r.started_at+interval '25 seconds' then raise exception 'round_too_short'; end if;
 if now()>r.expires_at then update public.customer_dash_rounds set status='expired' where id=p_round_id; raise exception 'round_expired'; end if;
 insert into public.customer_dash_rewards(user_id) values(p_user_id) on conflict(user_id) do nothing;
 select * into p from public.customer_dash_rewards where user_id=p_user_id for update;
 new_points:=least(5000,p.cycle_points+p_score);
 update public.customer_dash_rewards set lifetime_points=lifetime_points+p_score,cycle_points=new_points,best_score=greatest(best_score,p_score),updated_at=now() where user_id=p_user_id returning * into p;
 update public.customer_dash_rounds set status='submitted',submitted_at=now(),score=p_score,cycle_number=p.cycle_number where id=p_round_id;
 if new_points>=1000 then insert into public.customer_dash_milestones(user_id,cycle_number,milestone_points,reward_cents) values(p_user_id,p.cycle_number,1000,1000) on conflict do nothing; end if;
 if new_points>=2500 then insert into public.customer_dash_milestones(user_id,cycle_number,milestone_points,reward_cents) values(p_user_id,p.cycle_number,2500,2000) on conflict do nothing; end if;
 if new_points>=5000 then insert into public.customer_dash_milestones(user_id,cycle_number,milestone_points,reward_cents) values(p_user_id,p.cycle_number,5000,4000) on conflict do nothing; end if;
 return jsonb_build_object('lifetime_points',p.lifetime_points,'cycle_points',p.cycle_points,'cycle_number',p.cycle_number,'best_score',p.best_score);
end $$;
create or replace function public.customer_dash_review_milestone(p_milestone_id uuid,p_admin_id uuid,p_decision text,p_note text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare m public.customer_dash_milestones%rowtype; code text;
begin
 if p_decision not in('approve','reject') then raise exception 'invalid_decision'; end if;
 select * into m from public.customer_dash_milestones where id=p_milestone_id for update;
 if not found or m.status<>'pending' then raise exception 'milestone_not_pending'; end if;
 if p_decision='approve' then
  code:='DASH-'||upper(substr(encode(gen_random_bytes(6),'hex'),1,10));
  update public.customer_dash_milestones set status='approved',voucher_code=code,admin_user_id=p_admin_id,admin_note=nullif(left(coalesce(p_note,''),500),''),reviewed_at=now() where id=p_milestone_id;
 else
  update public.customer_dash_milestones set status='rejected',admin_user_id=p_admin_id,admin_note=nullif(left(coalesce(p_note,''),500),''),reviewed_at=now() where id=p_milestone_id;
 end if;
 if m.milestone_points=5000 then update public.customer_dash_rewards set cycle_points=0,cycle_number=cycle_number+1,updated_at=now() where user_id=m.user_id and cycle_number=m.cycle_number; end if;
 return jsonb_build_object('ok',true,'voucher_code',code);
end $$;
revoke all on function public.customer_dash_submit_round(uuid,uuid,integer) from public,anon,authenticated;
revoke all on function public.customer_dash_review_milestone(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.customer_dash_submit_round(uuid,uuid,integer) to service_role;
grant execute on function public.customer_dash_review_milestone(uuid,uuid,text,text) to service_role;
