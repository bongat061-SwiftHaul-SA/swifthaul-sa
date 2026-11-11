create table if not exists public.growth_milestones(
 id uuid primary key default gen_random_uuid(),
 category text not null check(category in ('combined_users','customers','drivers')),
 target_count integer not null check(target_count in (10,50,100,500)),
 is_unlocked boolean not null default false,
 unlocked_at timestamptz,
 trigger_user_id uuid references public.user_profiles(id) on delete set null,
 created_at timestamptz not null default now(),
 constraint growth_milestones_category_target_unique unique(category,target_count),
 constraint growth_milestones_unlock_consistency check((is_unlocked and unlocked_at is not null) or (not is_unlocked and unlocked_at is null))
);
create index if not exists growth_milestones_unlocked_idx on public.growth_milestones(is_unlocked,unlocked_at desc);
alter table public.user_profiles add column if not exists city text;
alter table public.user_profiles add column if not exists province text;
alter table public.growth_milestones enable row level security;
revoke all on public.growth_milestones from anon,authenticated;
grant all on public.growth_milestones to service_role;
insert into public.growth_milestones(category,target_count)
select c.category,t.target_count from (values('combined_users'),('customers'),('drivers')) c(category)
cross join (values(10),(50),(100),(500)) t(target_count)
on conflict(category,target_count) do nothing;
create or replace function public.check_and_unlock_growth_milestones()
returns trigger language plpgsql security definer set search_path=''
as $$
declare v_customers integer; v_drivers integer; v_combined integer;
begin
 if new.role not in ('customer','driver','fleet_owner') then return new; end if;
 if tg_op='UPDATE' and old.role is not distinct from new.role then return new; end if;
 select count(*)::integer into v_customers from public.user_profiles where role='customer';
 select count(*)::integer into v_drivers from public.user_profiles where role='driver';
 select count(*)::integer into v_combined from public.user_profiles where role in ('customer','driver','fleet_owner');
 update public.growth_milestones set is_unlocked=true,unlocked_at=now(),trigger_user_id=new.id
 where not is_unlocked and ((category='customers' and target_count<=v_customers) or (category='drivers' and target_count<=v_drivers) or (category='combined_users' and target_count<=v_combined));
 return new;
end $$;
revoke all on function public.check_and_unlock_growth_milestones() from public,anon,authenticated;
drop trigger if exists user_profiles_growth_milestone_insert on public.user_profiles;
drop trigger if exists user_profiles_growth_milestone_role_update on public.user_profiles;
create trigger user_profiles_growth_milestone_insert after insert on public.user_profiles for each row execute function public.check_and_unlock_growth_milestones();
create trigger user_profiles_growth_milestone_role_update after update of role on public.user_profiles for each row execute function public.check_and_unlock_growth_milestones();

create index if not exists user_profiles_growth_role_created_idx on public.user_profiles(role,created_at desc);
-- Backfill milestones already achieved before this migration was installed.
with counts as (
 select
  (select count(*)::integer from public.user_profiles where role='customer') customers,
  (select count(*)::integer from public.user_profiles where role='driver') drivers,
  (select count(*)::integer from public.user_profiles where role in ('customer','driver','fleet_owner')) combined
)
update public.growth_milestones gm
set is_unlocked=true,unlocked_at=now(),
 trigger_user_id=case
  when gm.category='customers' then (select id from public.user_profiles where role='customer' order by created_at desc limit 1)
  when gm.category='drivers' then (select id from public.user_profiles where role='driver' order by created_at desc limit 1)
  else (select id from public.user_profiles where role in ('customer','driver','fleet_owner') order by created_at desc limit 1)
 end
from counts
where not gm.is_unlocked and ((gm.category='customers' and gm.target_count<=counts.customers) or (gm.category='drivers' and gm.target_count<=counts.drivers) or (gm.category='combined_users' and gm.target_count<=counts.combined));
