create or replace function public.driver_can_accept_work(p_driver_user_id uuid)
returns boolean language plpgsql security definer set search_path=''
as $$
declare v_eligible boolean;
begin
 perform public.refresh_driver_online_eligibility(p_driver_user_id);
 select can_go_online into v_eligible from public.driver_profiles where user_id=p_driver_user_id;
 return coalesce(v_eligible,false);
end $$;
revoke all on function public.driver_can_accept_work(uuid) from public,anon,authenticated;
grant execute on function public.driver_can_accept_work(uuid) to service_role;