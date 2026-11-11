create or replace function public.refresh_driver_online_eligibility(p_driver_user_id uuid)
returns boolean language plpgsql security definer set search_path=''
as $$
declare v_profile public.driver_profiles%rowtype;v_required text[];v_ok boolean;v_today date:=timezone('Africa/Johannesburg',now())::date;
begin
 select * into v_profile from public.driver_profiles where user_id=p_driver_user_id;
 if not found then return false; end if;
 if v_profile.identity_type='sa_citizen' then
  v_required:=array['id_front','id_back','profile_selfie','licence_front','licence_back','vehicle_licence_disc','vehicle_insurance','proof_of_address'];
 elsif v_profile.identity_type='foreign_national' then
  v_required:=array['passport','work_permit','licence_front','licence_back','vehicle_licence_disc','vehicle_insurance','proof_of_address'];
 else
  v_required:=array['id_document','proof_of_address','bank_confirmation','drivers_licence','vehicle_document'];
 end if;
 select v_profile.onboarding_status='approved' and v_profile.criminal_background_clearance
  and not exists(select 1 from unnest(v_required) req(t) where not exists(
   select 1 from public.driver_documents d where d.driver_user_id=p_driver_user_id and d.document_type=req.t and d.verification_status='approved'
    and (d.expiry_date is null or d.expiry_date>=v_today)
    and (req.t not in ('licence_front','licence_back','vehicle_licence_disc','vehicle_insurance','passport','work_permit') or d.expiry_date is not null)
    and (req.t<>'proof_of_address' or (d.issued_at is not null and d.issued_at between v_today-92 and v_today))
  ))
  and exists(select 1 from public.driver_documents d where d.driver_user_id=p_driver_user_id and d.document_type in ('enatis_certificate','fleet_lease_agreement','vehicle_document') and d.verification_status='approved' and d.expiry_date is not null and d.expiry_date>=v_today)
  and (not v_profile.prdp_holder or exists(select 1 from public.driver_documents d where d.driver_user_id=p_driver_user_id and d.document_type='prdp' and d.verification_status='approved' and d.expiry_date is not null and d.expiry_date>=v_today))
 into v_ok;
 update public.driver_profiles set can_go_online=coalesce(v_ok,false),is_online=case when coalesce(v_ok,false) then is_online else false end,
  availability_status=case when coalesce(v_ok,false) then availability_status else 'offline' end,updated_at=now() where user_id=p_driver_user_id;
 return coalesce(v_ok,false);
end $$;
revoke all on function public.refresh_driver_online_eligibility(uuid) from public,anon,authenticated;
grant execute on function public.refresh_driver_online_eligibility(uuid) to service_role;