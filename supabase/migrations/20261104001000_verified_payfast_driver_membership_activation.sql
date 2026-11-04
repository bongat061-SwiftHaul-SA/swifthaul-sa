create or replace function public.apply_payfast_driver_membership(p_membership_id uuid,p_pf_payment_id text,p_amount numeric)
returns boolean language plpgsql security definer set search_path=public as $$
declare m public.driver_memberships%rowtype;
begin
 if p_pf_payment_id is null or length(p_pf_payment_id) not between 1 and 100 or p_amount is null then return false; end if;
 select * into m from public.driver_memberships where id=p_membership_id for update;
 if not found then return false; end if;
 if m.status='active' and m.provider_payment_id=p_pf_payment_id then return true; end if;
 if m.status<>'pending' or m.provider_payment_id is not null or round(m.amount_cents::numeric/100,2)<>round(p_amount,2) then return false; end if;
 if exists(select 1 from public.driver_memberships where driver_user_id=m.driver_user_id and status='active' and ends_at>now()) then return false; end if;
 update public.driver_memberships set status='active',starts_at=now(),ends_at=case when plan='monthly' then now()+interval '1 month' else now()+interval '1 year' end,provider_payment_id=p_pf_payment_id,updated_at=now() where id=m.id;
 insert into public.driver_membership_revenue_ledger(event_key,driver_user_id,membership_id,event_type,amount_cents,provider_reference,description)
 values('membership-paid:'||m.id,m.driver_user_id,m.id,'subscription_paid',m.amount_cents,p_pf_payment_id,'Verified PayFast premium driver membership payment') on conflict(event_key) do nothing;
 return true;
end; $$;
revoke all on function public.apply_payfast_driver_membership(uuid,text,numeric) from public,anon,authenticated;
grant execute on function public.apply_payfast_driver_membership(uuid,text,numeric) to service_role;