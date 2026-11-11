begin;
alter table public.customer_bookings add column if not exists tracking_code text;
update public.customer_bookings set tracking_code=replace(gen_random_uuid()::text,'-','') where tracking_code is null;
alter table public.customer_bookings alter column tracking_code set default replace(gen_random_uuid()::text,'-','');
alter table public.customer_bookings alter column tracking_code set not null;
create unique index if not exists customer_bookings_tracking_code_uidx on public.customer_bookings(tracking_code);
alter table public.customer_bookings add column if not exists recipient_phone text;
alter table public.payment_transactions add column if not exists paystack_access_code text;
create index if not exists payment_transactions_paystack_ref_idx on public.payment_transactions(provider_reference) where provider='paystack';
alter table public.driver_profiles add column if not exists paystack_recipient_code text;
alter table public.driver_profiles add column if not exists paystack_recipient_created_at timestamptz;
create table if not exists public.driver_payouts(
 id uuid primary key default gen_random_uuid(),
 driver_id uuid not null references auth.users(id) on delete restrict,
 amount_zar numeric(12,2) not null check(amount_zar>=1),
 paystack_transfer_code text unique,
 reference text not null unique,
 status text not null default 'pending' check(status in('pending','processing','success','failed')),
 payout_period_start date,
 payout_period_end date,
 failure_reason text,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 completed_at timestamptz
);
create index if not exists driver_payouts_driver_created_idx on public.driver_payouts(driver_id,created_at desc);
alter table public.driver_payouts enable row level security;
revoke all on public.driver_payouts from anon,authenticated;
create table if not exists public.public_tracking_locations(
 tracking_code text primary key,
 waybill text not null unique references public.customer_bookings(waybill) on delete cascade,
 latitude double precision not null check(latitude between -90 and 90),
 longitude double precision not null check(longitude between -180 and 180),
 updated_at timestamptz not null default now()
);
alter table public.public_tracking_locations enable row level security;
revoke all on public.public_tracking_locations from anon,authenticated;
grant select on public.public_tracking_locations to anon,authenticated;
drop policy if exists "public active tracking location read" on public.public_tracking_locations;
create policy "public active tracking location read" on public.public_tracking_locations for select to anon,authenticated
using(exists(select 1 from public.customer_bookings b where b.waybill=public_tracking_locations.waybill and b.tracking_code=public_tracking_locations.tracking_code and b.paid_at is not null and b.refunded_at is null and b.status in('assigned','accepted','picked_up','in_transit')));
do $$ begin
 if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='public_tracking_locations') then
  alter publication supabase_realtime add table public.public_tracking_locations;
 end if;
end $$;
create or replace function public.credit_driver_after_verified_delivery()
returns trigger language plpgsql security definer set search_path='public'
as $$
declare b public.customer_bookings%rowtype; v_net bigint;
begin
 select * into b from public.customer_bookings where waybill=new.waybill;
 if not found or b.paid_at is null or b.refunded_at is not null or b.status<>'delivered' or b.driver_user_id is null or new.recipient_pin_verified_at is null then return new; end if;
 v_net:=round(b.price*100*0.75)::bigint;
 if v_net<=0 then return new; end if;
 insert into public.driver_earnings_ledger(driver_user_id,event_key,event_type,amount_cents,waybill,description)
 values(b.driver_user_id,'paid-delivery:'||b.waybill,'delivery_completed',v_net,b.waybill,'75% driver share after verified recipient OTP')
 on conflict(event_key) do nothing;
 return new;
end $$;
drop trigger if exists credit_driver_after_verified_delivery on public.proof_of_delivery;
create trigger credit_driver_after_verified_delivery after insert or update of recipient_pin_verified_at on public.proof_of_delivery for each row execute function public.credit_driver_after_verified_delivery();
create or replace function public.apply_paystack_payment(p_payment_id uuid,p_reference text,p_amount_cents bigint,p_payload jsonb)
returns boolean language plpgsql security definer set search_path='public'
as $$
declare p public.payment_transactions%rowtype; b public.customer_bookings%rowtype; v_otp text;
begin
 select * into p from public.payment_transactions where id=p_payment_id and provider='paystack' for update;
 if not found then return false; end if;
 if p.status='complete' then return p.provider_reference=p_reference; end if;
 if p.status<>'pending' or p_reference is null or length(p_reference)>100 or round(p.amount*100)::bigint<>p_amount_cents then return false; end if;
 select * into b from public.customer_bookings where waybill=p.booking_waybill and owner_hash=p.owner_id::text for update;
 if not found or b.paid_at is not null or b.refunded_at is not null or b.status in('cancelled','delivered') then return false; end if;
 v_otp:=lpad((floor(random()*10000))::int::text,4,'0');
 update public.payment_transactions set status='complete',provider_reference=p_reference,raw_itn=p_payload,completed_at=now(),updated_at=now() where id=p.id and status='pending';
 update public.customer_bookings set paid_at=now(),payment_source='paystack',pin=v_otp,pin_attempts=0,pin_locked_until=null where waybill=b.waybill;
 insert into public.delivery_status_events(waybill,actor_user_id,previous_status,new_status,notes,metadata)
 values(b.waybill,null,b.status,b.status,'Paystack ZAR payment confirmed',jsonb_build_object('payment_provider','paystack','reference',p_reference));
 return true;
end $$;
revoke all on function public.apply_paystack_payment(uuid,text,bigint,jsonb) from public,anon,authenticated;
grant execute on function public.apply_paystack_payment(uuid,text,bigint,jsonb) to service_role;
commit;
