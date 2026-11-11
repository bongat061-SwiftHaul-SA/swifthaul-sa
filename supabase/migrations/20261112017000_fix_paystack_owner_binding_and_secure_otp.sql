create or replace function public.apply_paystack_payment(p_payment_id uuid,p_reference text,p_amount_cents bigint,p_payload jsonb)
returns boolean language plpgsql security definer set search_path='public'
as $$
declare p public.payment_transactions%rowtype; b public.customer_bookings%rowtype; v_otp text;v_updated integer;v_owner_hash text;
begin
 select * into p from public.payment_transactions where id=p_payment_id and provider='paystack' for update;
 if not found then return false; end if;
 if p.status='complete' then return p.provider_reference=p_reference; end if;
 if p.status<>'pending' or p_reference is null or length(p_reference)>100 or round(p.amount*100)::bigint<>p_amount_cents then return false; end if;
 v_owner_hash:=encode(digest('identity:'||p.owner_id::text,'sha256'),'hex');
 select * into b from public.customer_bookings where waybill=p.booking_waybill and owner_hash=v_owner_hash for update;
 if not found or b.paid_at is not null or b.refunded_at is not null or b.status in('cancelled','delivered') then return false; end if;
 v_otp:=lpad((('x'||substr(replace(gen_random_uuid()::text,'-',''),1,8))::bit(32)::bigint%10000)::text,4,'0');
 update public.payment_transactions set status='complete',provider_reference=p_reference,raw_itn=p_payload,completed_at=now(),updated_at=now() where id=p.id and status='pending';
 get diagnostics v_updated=row_count;if v_updated<>1 then return false;end if;
 update public.customer_bookings set paid_at=now(),payment_source='paystack',pin=v_otp,pin_attempts=0,pin_locked_until=null where waybill=b.waybill;
 insert into public.delivery_status_events(waybill,actor_user_id,previous_status,new_status,notes,metadata)
 values(b.waybill,null,b.status,b.status,'Paystack ZAR payment confirmed',jsonb_build_object('payment_provider','paystack','reference',p_reference));
 perform public.create_next_driver_offer(b.waybill);
 return true;
end $$;
revoke all on function public.apply_paystack_payment(uuid,text,bigint,jsonb) from public,anon,authenticated;
grant execute on function public.apply_paystack_payment(uuid,text,bigint,jsonb) to service_role;