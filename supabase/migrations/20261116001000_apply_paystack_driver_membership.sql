create or replace function public.apply_paystack_driver_membership(p_membership_id uuid,p_reference text,p_amount_cents bigint)
returns boolean language plpgsql security definer set search_path=public as $$
declare m public.driver_memberships%rowtype; expected_amount bigint;
begin
 if p_reference is null or length(p_reference) not between 1 and 100 or p_amount_cents is null then return false; end if;
 select * into m from public.driver_memberships where id=p_membership_id for update;
 if not found then return false; end if;
 if m.status='active' and m.provider='paystack' and m.provider_payment_id=p_reference then return true; end if;
 expected_amount:=case when m.plan='monthly' then 25000 when m.plan='yearly' then 180000 else 0 end;
 if m.provider<>'paystack' or m.status<>'pending' or m.provider_payment_id is not null or expected_amount=0 or m.amount_cents<>expected_amount or p_amount_cents<>expected_amount then return false; end if;
 if exists(select 1 from public.driver_memberships where driver_user_id=m.driver_user_id and status='active' and ends_at>now()) then return false; end if;
 update public.driver_memberships set status='active',starts_at=now(),ends_at=case when m.plan='monthly' then now()+interval '1 month' else now()+interval '1 year' end,provider_payment_id=p_reference,updated_at=now() where id=m.id;
 insert into public.driver_membership_revenue_ledger(event_key,driver_user_id,membership_id,event_type,amount_cents,provider_reference,description)
 values('membership-paid:'||m.id,m.driver_user_id,m.id,'subscription_paid',m.amount_cents,p_reference,'Verified Paystack premium driver membership payment') on conflict(event_key) do nothing;
 return true;
end; $$;
revoke all on function public.apply_paystack_driver_membership(uuid,text,bigint) from public,anon,authenticated;
grant execute on function public.apply_paystack_driver_membership(uuid,text,bigint) to service_role;